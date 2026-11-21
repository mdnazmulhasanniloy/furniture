import { Prisma, type Category } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { buildImageAsset, syncImages, type R2Context } from '../../lib/r2.js';
import type { CreateCategoryBody, UpdateCategoryBody } from './schema.js';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Category not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isSlugConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const mapError = (err: unknown): unknown =>
  isSlugConflict(err)
    ? new AppError(409, 'SLUG_TAKEN', 'Another category already uses this slug')
    : err;

export type SaveContext = R2Context & { uploadedById: string };
const noRelease = async () => {};

const toCategory = (c: Category) => ({
  id: c.id,
  name: c.name,
  slug: c.slug,
  image: c.image ?? null,
  parentId: c.parentId ?? null,
  sortOrder: c.sortOrder,
  isActive: c.isActive,
});

/** CAT-01: active roots with their active children nested one level, sorted by sortOrder then slug. */
export async function getPublicTree() {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  });
  // The tree is built in memory: a `{ parentId: null }` where-filter would miss documents created
  // without the field (null-vs-missing, CLAUDE.md rule 8; seeded categories have no parentId).
  const byParent = new Map<string, Category[]>();
  const roots: Category[] = [];
  for (const row of rows) {
    if (row.parentId) {
      const list = byParent.get(row.parentId) ?? [];
      list.push(row);
      byParent.set(row.parentId, list);
    } else {
      roots.push(row);
    }
  }
  // A child whose parent is inactive (absent from `rows`) stays hidden, never re-rooted.
  return roots.map((root) => ({
    ...toCategory(root),
    children: (byParent.get(root.id) ?? []).map(toCategory),
  }));
}

/** ADM-03: flat list, incl. inactive, with productCount (any status, incl. ARCHIVED). */
export async function listAdmin() {
  const [rows, counts] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }] }),
    prisma.product.groupBy({ by: ['categoryId'], _count: { _all: true } }),
  ]);
  const countBy = new Map(counts.map((c) => [c.categoryId, c._count._all]));
  return rows.map((row) => ({ ...toCategory(row), productCount: countBy.get(row.id) ?? 0 }));
}

/** One level of sub-categories (CAT-01): the parent must exist and be a root. */
async function assertValidParent(db: Prisma.TransactionClient, parentId: string, selfId?: string) {
  if (parentId === selfId) throw validation('A category cannot be its own parent');
  const parent = await db.category.findUnique({ where: { id: parentId } });
  if (!parent) throw validation('Parent category not found');
  if (parent.parentId) throw validation('Only one level of sub-categories is allowed');
}

export async function create(body: CreateCategoryBody, ctx: SaveContext) {
  const image = body.image ? buildImageAsset(body.image.key, { alt: body.image.alt }) : null;
  try {
    const row = await prisma.$transaction(async (tx) => {
      if (body.parentId) await assertValidParent(tx, body.parentId);
      if (image) await syncImages(tx, [], [image.key], 'admin', ctx);
      return tx.category.create({
        data: {
          name: body.name,
          slug: body.slug,
          // Optional fields are written as explicit null (null-vs-missing, CLAUDE.md rule 8).
          image,
          parentId: body.parentId ?? null,
          sortOrder: body.sortOrder ?? 0,
          isActive: body.isActive ?? true,
        },
      });
    });
    return toCategory(row);
  } catch (err) {
    throw mapError(err);
  }
}

export async function update(
  id: string,
  body: UpdateCategoryBody,
  ctx: SaveContext,
): Promise<{ category: ReturnType<typeof toCategory>; release: () => Promise<void> }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let release = noRelease;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.category.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (body.parentId) {
        await assertValidParent(tx, body.parentId, id);
        if ((await tx.category.count({ where: { parentId: id } })) > 0) {
          throw validation('A category with sub-categories cannot have a parent');
        }
      }
      const data: Prisma.CategoryUncheckedUpdateInput = {};
      if (body.name !== undefined) data.name = body.name;
      if (body.slug !== undefined) data.slug = body.slug;
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) data.isActive = body.isActive;
      if ('parentId' in body) data.parentId = body.parentId ?? null;
      if ('image' in body) {
        const next = body.image ? buildImageAsset(body.image.key, { alt: body.image.alt }) : null;
        const sync = await syncImages(
          tx,
          current.image ? [current.image.key] : [],
          next ? [next.key] : [],
          'admin',
          ctx,
        );
        release = sync.release;
        data.image = next;
      }
      return tx.category.update({ where: { id }, data });
    });
    return { category: toCategory(row), release };
  } catch (err) {
    // The transaction rolled back: the caller never gets (and never calls) release.
    throw mapError(err);
  }
}

export async function remove(
  id: string,
  ctx: SaveContext,
): Promise<{ release: () => Promise<void> }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let release = noRelease;
  await prisma.$transaction(async (tx) => {
    const current = await tx.category.findUnique({ where: { id } });
    if (!current) throw notFound();
    if ((await tx.category.count({ where: { parentId: id } })) > 0) {
      throw new AppError(409, 'CATEGORY_HAS_CHILDREN', 'Delete or move its sub-categories first');
    }
    if ((await tx.product.count({ where: { categoryId: id } })) > 0) {
      throw new AppError(409, 'CATEGORY_HAS_PRODUCTS', 'The category still has products');
    }
    const sync = await syncImages(tx, current.image ? [current.image.key] : [], [], 'admin', ctx);
    release = sync.release;
    await tx.category.delete({ where: { id } });
  });
  return { release };
}
