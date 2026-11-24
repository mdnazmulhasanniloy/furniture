import { Prisma, type Category, type Product } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { buildImageAsset, syncImages, type ImageAsset, type R2Context } from '../../lib/r2.js';
import {
  buildSearchText,
  escapeRegex,
  normalizeSearch,
  searchWhere,
} from '../../lib/searchText.js';
import type {
  AdminListQuery,
  CreateProductBody,
  PublicListQuery,
  UpdateProductBody,
} from './schema.js';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const RELATED_LIMIT = 8; // owner 2026-11-22

const notFound = () => new AppError(404, 'NOT_FOUND', 'Product not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isP2002 = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
const slugTaken = () => new AppError(409, 'SLUG_TAKEN', 'Another product already uses this slug');

export type SaveContext = R2Context & { uploadedById: string };
const noRelease = async () => {};

type ProductWithCategory = Product & { category: Category };

const toCategory = (c: Category) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  image: c.image ?? null,
  parentId: c.parentId ?? null,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

/** API shape: optionals as explicit null, `searchText` never exposed. Reused by the CMS home resolver (T-011). */
export const toProduct = (p: ProductWithCategory) => ({
  id: p.id,
  title: p.title,
  description: p.description,
  slug: p.slug,
  sku: p.sku ?? null,
  type: p.type,
  condition: p.condition,
  conditionNotes: p.conditionNotes ?? null,
  price: p.price,
  compareAtPrice: p.compareAtPrice ?? null,
  stock: p.stock,
  categoryId: p.categoryId,
  category: toCategory(p.category),
  images: p.images,
  dimensions: p.dimensions ?? null,
  material: p.material ?? null,
  color: p.color ?? null,
  isFeatured: p.isFeatured,
  status: p.status,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});
export type ProductResponse = ReturnType<typeof toProduct>;

// ---------------------------------------------------------------- business rules (owner 2026-11-22)

interface RuleFields {
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  type: 'NEW' | 'RESALE';
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR';
  price: number;
  compareAtPrice: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
}

/** I18N-02 + type/condition + compareAtPrice, applied to the create body or the merged patch result. */
function assertRules(p: RuleFields): void {
  const filled = (t: { en: string; ar: string }) =>
    Number(t.en.trim() !== '') + Number(t.ar.trim() !== '');
  for (const [field, text] of [
    ['title', p.title],
    ['description', p.description],
  ] as const) {
    if (p.status === 'PUBLISHED' && filled(text) < 2) {
      throw validation(`A published product needs ${field} in both en and ar (I18N-02)`);
    }
    if (filled(text) < 1) throw validation(`${field} needs at least one non-empty locale`);
  }
  if (p.type === 'NEW' && p.condition !== 'NEW') {
    throw validation('A NEW product must have condition NEW');
  }
  if (p.type === 'RESALE' && p.condition === 'NEW') {
    throw validation('A RESALE product must have condition LIKE_NEW, GOOD or FAIR');
  }
  if (p.compareAtPrice !== null && p.compareAtPrice <= p.price) {
    throw validation('compareAtPrice must be greater than price');
  }
}

async function assertCategoryExists(db: Prisma.TransactionClient, categoryId: string) {
  if (!(await db.category.findUnique({ where: { id: categoryId } }))) {
    throw validation('Category not found');
  }
}

// ---------------------------------------------------------------- public (PROD-01, PROD-02)

const SORTS: Record<PublicListQuery['sort'], Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  price_asc: [{ price: 'asc' }, { id: 'desc' }],
  price_desc: [{ price: 'desc' }, { id: 'desc' }],
  featured: [{ isFeatured: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
};

const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

/** A category slug resolves to itself plus its direct sub-categories; unknown slug -> no ids. */
async function categoryIdsForSlug(slug: string): Promise<string[] | null> {
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) return null;
  const children = await prisma.category.findMany({
    where: { parentId: category.id },
    select: { id: true },
  });
  return [category.id, ...children.map((c) => c.id)];
}

export async function listPublic(query: PublicListQuery) {
  const where: Prisma.ProductWhereInput = { status: 'PUBLISHED' };
  if (query.category !== undefined) {
    const ids = await categoryIdsForSlug(query.category);
    if (ids === null) return { items: [], meta: pageMeta(query.page, query.limit, 0) };
    where.categoryId = { in: ids };
  }
  if (query.type) where.type = query.type;
  if (query.condition) where.condition = { in: query.condition };
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    where.price = {
      ...(query.minPrice !== undefined && { gte: query.minPrice }),
      ...(query.maxPrice !== undefined && { lte: query.maxPrice }),
    };
  }
  if (query.material !== undefined) {
    // mode:'insensitive' equals is also $regex-backed on MongoDB, so it must be escaped (rule 9).
    where.material = { equals: escapeRegex(query.material), mode: 'insensitive' };
  }
  if (query.inStock === true) where.stock = { gt: 0 };
  if (query.inStock === false) where.stock = { equals: 0 };
  if (query.featured !== undefined) where.isFeatured = query.featured;
  if (query.q !== undefined && query.q.trim() !== '') {
    // words (AND), plural/singular, title + description + category + material in en and ar
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      searchWhere(query.q),
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: SORTS[query.sort],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return { items: rows.map(toProduct), meta: pageMeta(query.page, query.limit, total) };
}

export async function getPublicBySlug(slug: string) {
  const row = await prisma.product.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: { category: true },
  });
  if (!row) throw notFound();
  const related = await prisma.product.findMany({
    where: { categoryId: row.categoryId, status: 'PUBLISHED', id: { not: row.id } },
    include: { category: true },
    orderBy: SORTS.newest,
    take: RELATED_LIMIT,
  });
  return { product: toProduct(row), related: related.map(toProduct) };
}

// ---------------------------------------------------------------- admin (ADM-02)

export async function listAdmin(query: AdminListQuery) {
  const where: Prisma.ProductWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.type) where.type = query.type;
  if (query.q !== undefined && query.q.trim() !== '') {
    where.searchText = { contains: escapeRegex(normalizeSearch(query.q)), mode: 'insensitive' };
  }
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: SORTS.newest,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return { items: rows.map(toProduct), meta: pageMeta(query.page, query.limit, total) };
}

export async function getById(id: string) {
  if (!OBJECT_ID.test(id)) throw notFound();
  const row = await prisma.product.findUnique({ where: { id }, include: { category: true } });
  if (!row) throw notFound();
  return toProduct(row);
}

export async function create(body: CreateProductBody, ctx: SaveContext) {
  const status = body.status ?? 'DRAFT';
  assertRules({
    title: body.title,
    description: body.description,
    type: body.type,
    condition: body.condition,
    price: body.price,
    compareAtPrice: body.compareAtPrice ?? null,
    status,
  });
  const images = (body.images ?? []).map((i) => buildImageAsset(i.key, { alt: i.alt }));
  try {
    const row = await prisma.$transaction(async (tx) => {
      await assertCategoryExists(tx, body.categoryId);
      if (images.length) {
        await syncImages(
          tx,
          [],
          images.map((i) => i.key),
          'admin',
          ctx,
        );
      }
      return tx.product.create({
        data: {
          title: body.title,
          description: body.description,
          slug: body.slug,
          type: body.type,
          condition: body.condition,
          price: body.price,
          stock: body.stock,
          categoryId: body.categoryId,
          images,
          isFeatured: body.isFeatured ?? false,
          status,
          searchText: buildSearchText(body.title),
          // Optional fields are written as explicit null (null-vs-missing, CLAUDE.md rule 8).
          sku: body.sku ?? null,
          conditionNotes: body.conditionNotes ?? null,
          compareAtPrice: body.compareAtPrice ?? null,
          dimensions: body.dimensions ?? null,
          material: body.material ?? null,
          color: body.color ?? null,
        },
        include: { category: true },
      });
    });
    return toProduct(row);
  } catch (err) {
    throw isP2002(err) ? slugTaken() : err;
  }
}

const staleUpdate = (current: ProductWithCategory) =>
  new AppError(409, 'STALE_UPDATE', 'The product was changed by someone else; reload and retry', {
    current: toProduct(current),
  });

export interface UpdateResult {
  product: ProductResponse;
  oldSlug: string;
  release: () => Promise<void>;
}

export async function update(
  id: string,
  body: UpdateProductBody,
  ctx: SaveContext,
): Promise<UpdateResult> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let release = noRelease;
  try {
    const { row, oldSlug } = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findUnique({ where: { id }, include: { category: true } });
      if (!current) throw notFound();
      // Optimistic concurrency (owner 2026-11-22): the admin edited the version they loaded.
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      assertRules({
        title: body.title ?? current.title,
        description: body.description ?? current.description,
        type: body.type ?? current.type,
        condition: body.condition ?? current.condition,
        price: body.price ?? current.price,
        compareAtPrice:
          'compareAtPrice' in body
            ? (body.compareAtPrice ?? null)
            : (current.compareAtPrice ?? null),
        status: body.status ?? current.status,
      });
      if (body.categoryId !== undefined && body.categoryId !== current.categoryId) {
        await assertCategoryExists(tx, body.categoryId);
      }

      const data: Prisma.ProductUncheckedUpdateInput = {};
      if (body.title !== undefined) {
        data.title = body.title;
        data.searchText = buildSearchText(body.title);
      }
      if (body.description !== undefined) data.description = body.description;
      if (body.slug !== undefined) data.slug = body.slug;
      if (body.type !== undefined) data.type = body.type;
      if (body.condition !== undefined) data.condition = body.condition;
      if (body.price !== undefined) data.price = body.price;
      if (body.stock !== undefined) data.stock = body.stock;
      if (body.categoryId !== undefined) data.categoryId = body.categoryId;
      if (body.isFeatured !== undefined) data.isFeatured = body.isFeatured;
      if (body.status !== undefined) data.status = body.status;
      if ('sku' in body) data.sku = body.sku ?? null;
      if ('conditionNotes' in body) data.conditionNotes = body.conditionNotes ?? null;
      if ('compareAtPrice' in body) data.compareAtPrice = body.compareAtPrice ?? null;
      if ('dimensions' in body) data.dimensions = body.dimensions ?? null;
      if ('material' in body) data.material = body.material ?? null;
      if ('color' in body) data.color = body.color ?? null;
      if (body.images !== undefined) {
        const next = body.images.map((i) => buildImageAsset(i.key, { alt: i.alt }));
        const sync = await syncImages(
          tx,
          current.images.map((i) => i.key),
          next.map((i) => i.key),
          'admin',
          ctx,
        );
        release = sync.release;
        data.images = next;
      }

      // One conditional write: nothing matches when someone saved in between -> 409, nothing changed.
      const res = await tx.product.updateMany({
        where: { id, updatedAt: body.expectedUpdatedAt },
        data,
      });
      if (res.count !== 1) throw staleUpdate(current);
      const updated = await tx.product.findUniqueOrThrow({
        where: { id },
        include: { category: true },
      });
      return { row: updated, oldSlug: current.slug };
    });
    return { product: toProduct(row), oldSlug, release };
  } catch (err) {
    // The transaction rolled back: the caller never gets (and never calls) release.
    if (isP2002(err)) throw slugTaken();
    if (isWriteConflict(err)) {
      const current = await prisma.product.findUnique({
        where: { id },
        include: { category: true },
      });
      throw current ? staleUpdate(current) : notFound();
    }
    throw err;
  }
}

export interface RemoveResult {
  archived: boolean;
  slug: string;
  release: () => Promise<void>;
}

/** Hard delete releases every image; a product referenced by any order is archived (images kept). */
export async function remove(id: string, ctx: SaveContext): Promise<RemoveResult> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let release = noRelease;
  let archived = false;
  let slug = '';
  await prisma.$transaction(async (tx) => {
    const current = await tx.product.findUnique({ where: { id } });
    if (!current) throw notFound();
    slug = current.slug;
    const inOrders = await tx.order.count({ where: { items: { some: { productId: id } } } });
    if (inOrders > 0) {
      archived = true;
      await tx.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
      return; // images kept (ADM-02)
    }
    const sync = await syncImages(
      tx,
      current.images.map((i) => i.key),
      [],
      'admin',
      ctx,
    );
    release = sync.release;
    await tx.product.delete({ where: { id } });
  });
  return { archived, slug, release };
}

export type { ImageAsset };
