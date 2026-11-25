import { Prisma, type HomeSection } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { createLogger, type Logger } from '../../lib/logger.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { buildImageAsset, syncImages, type R2Context } from '../../lib/r2.js';
import type { CreateSectionBody, UpdateSectionBody } from './schema.js';

export type SaveContext = R2Context & { uploadedById: string };
const noRelease = async () => {};

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Home section not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

export const toSection = (s: HomeSection) => ({
  id: s.id,
  type: s.type,
  title: s.title,
  subtitle: s.subtitle ?? null,
  config: s.config ?? null,
  sortOrder: s.sortOrder,
  isVisible: s.isVisible,
  updatedAt: s.updatedAt,
});
export type SectionResponse = ReturnType<typeof toSection>;

const staleUpdate = (current: HomeSection) =>
  new AppError(409, 'STALE_UPDATE', 'The section was changed by someone else; reload and retry', {
    current: toSection(current),
  });

/** MongoDB Json fields take plain null (no DbNull/JsonNull split on this connector). */
const configValue = (config: CreateSectionBody['config']): Prisma.InputJsonValue | null =>
  config === undefined ? null : (config as Prisma.InputJsonValue);

/** R2 key of the SHOP_THE_LOOK photo stored in a config, if any. */
const lookKey = (config: unknown): string | null => {
  const key = (config as { look?: { image?: { key?: unknown } } } | null)?.look?.image?.key;
  return typeof key === 'string' ? key : null;
};

/**
 * Request shape -> stored shape: the photo becomes a full ImageAsset (the server recomputes the url from
 * the key and rejects keys outside this deployment's R2 scope, so a client cannot store a foreign URL).
 */
function storedConfig(config: CreateSectionBody['config']): CreateSectionBody['config'] {
  if (!config?.look) return config;
  const { key, alt, width, height } = config.look.image;
  return {
    ...config,
    look: { ...config.look, image: buildImageAsset(key, { alt, width, height }) },
  } as CreateSectionBody['config'];
}

/**
 * T-110, checked inside the write transaction so nothing can slip in between the check and the write:
 * a product may be used once per look, and every product must exist and be PUBLISHED when the look is saved.
 * A product unpublished *later* is not an error - `GET /cms/home` drops that hotspot and the admin response
 * flags it - but an admin must never be able to publish a look that is already broken.
 */
async function assertLookProducts(
  tx: Prisma.TransactionClient,
  config: CreateSectionBody['config'],
): Promise<void> {
  const spots = config?.look?.hotspots ?? [];
  if (spots.length === 0) return;
  const ids = spots.map((h) => h.productId);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    const repeated = unique.filter((id) => ids.filter((x) => x === id).length > 1);
    throw new AppError(422, 'DUPLICATE_PRODUCT', 'A product can be used once per look', {
      productIds: repeated,
    });
  }
  const rows = await tx.product.findMany({
    where: { id: { in: unique }, status: 'PUBLISHED' },
    select: { id: true },
  });
  const published = new Set(rows.map((p) => p.id));
  const missing = unique.filter((id) => !published.has(id));
  if (missing.length > 0) {
    throw new AppError(422, 'PRODUCT_NOT_PUBLISHED', 'Every hotspot needs a published product', {
      productIds: missing,
    });
  }
}

/**
 * One audit line per look write (T-110), in the shape T-104 established: who, which section, how many points
 * and which products - no photo key, no copy, nothing personal.
 */
let auditFallback: Logger | undefined;
function auditLook(
  ctx: SaveContext,
  action: 'section.look.save' | 'section.look.delete',
  sectionId: string,
  config: unknown,
): void {
  const spots = hotspotsOf(config);
  if (spots.length === 0 && action === 'section.look.save') return;
  const log: Pick<Logger, 'info'> = (ctx.log as Partial<Logger> | undefined)?.info
    ? (ctx.log as Logger)
    : (auditFallback ??= createLogger(getEnv()));
  log.info(
    {
      event: action,
      actorId: ctx.uploadedById,
      targetId: sectionId,
      points: spots.length,
      productIds: spots.map((h) => h.productId).filter((id) => typeof id === 'string'),
      at: new Date().toISOString(),
      requestId: ctx.requestId,
    },
    action,
  );
}

/** The slim product an admin hotspot carries (spec `LookHotspotProduct`); never stored. */
type HotspotProduct = {
  id: string;
  title: Prisma.JsonValue;
  slug: string;
  price: number;
  status: string;
  image: Prisma.JsonValue;
};

const hotspotsOf = (config: unknown): Prisma.JsonObject[] => {
  const spots = (config as { look?: { hotspots?: unknown } } | null)?.look?.hotspots;
  // A malformed stored config must never throw here (the admin list has to stay readable).
  return Array.isArray(spots)
    ? (spots.filter((h) => typeof h === 'object' && h !== null) as Prisma.JsonObject[])
    : [];
};

/**
 * Admin responses only (T-110): each hotspot gets the product as it is **now**, so the looks list and the
 * editor can show it and warn about one that is no longer published without a request per hotspot. A deleted
 * product becomes `null`, which is what tells the editor to offer a replacement. `GET /cms/home` does not use
 * this: it resolves its own published-only products.
 */
export async function withLookProducts(list: SectionResponse[]): Promise<SectionResponse[]> {
  const ids = [
    ...new Set(
      list.flatMap((s) =>
        hotspotsOf(s.config)
          .map((h) => h.productId)
          .filter((id): id is string => typeof id === 'string'),
      ),
    ),
  ];
  if (ids.length === 0) return list;
  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, slug: true, price: true, status: true, images: true },
  });
  const byId = new Map<string, HotspotProduct>(
    rows.map((p) => [
      p.id,
      {
        id: p.id,
        title: p.title,
        slug: p.slug,
        price: p.price,
        status: p.status,
        image: Array.isArray(p.images) ? (p.images[0] ?? null) : null,
      },
    ]),
  );
  return list.map((s) => {
    const spots = hotspotsOf(s.config);
    if (spots.length === 0) return s;
    const config = s.config as { look: { hotspots: unknown[] } };
    return {
      ...s,
      config: {
        ...config,
        look: {
          ...config.look,
          hotspots: spots.map((h) => ({
            ...h,
            product: typeof h.productId === 'string' ? (byId.get(h.productId) ?? null) : null,
          })),
        },
      },
    };
  });
}

const withProducts = async (section: SectionResponse): Promise<SectionResponse> =>
  (await withLookProducts([section]))[0]!;

/** config.look belongs to SHOP_THE_LOOK and to nothing else (ADM-15). */
function assertTypeMatchesConfig(type: string, config: unknown): void {
  const hasLook = !!(config as { look?: unknown } | null)?.look;
  if (type === 'SHOP_THE_LOOK' && !hasLook)
    throw validation('config.look is required for SHOP_THE_LOOK');
  if (type !== 'SHOP_THE_LOOK' && hasLook)
    throw validation('config.look is only allowed for SHOP_THE_LOOK');
}

export async function list(): Promise<SectionResponse[]> {
  const rows = await prisma.homeSection.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return withLookProducts(rows.map(toSection));
}

export async function create(body: CreateSectionBody, ctx: SaveContext): Promise<SectionResponse> {
  assertTypeMatchesConfig(body.type, body.config);
  const config = storedConfig(body.config);
  const key = lookKey(config);
  const row = await prisma.$transaction(async (tx) => {
    await assertLookProducts(tx, config); // before the photo is attached, so a refused save attaches nothing
    if (key) await syncImages(tx, [], [key], 'admin', ctx); // the photo is an R2 upload attached to the section
    return tx.homeSection.create({
      data: {
        type: body.type,
        title: body.title,
        subtitle: body.subtitle ?? null, // explicit null (rule 8)
        config: configValue(config),
        sortOrder: body.sortOrder ?? 0,
        isVisible: body.isVisible ?? true,
      },
    });
  });
  auditLook(ctx, 'section.look.save', row.id, row.config);
  return withProducts(toSection(row));
}

export async function update(
  id: string,
  body: UpdateSectionBody,
  ctx: SaveContext,
): Promise<{ section: SectionResponse; release: () => Promise<void> }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  try {
    let release = noRelease;
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.homeSection.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      const finalType = body.type ?? current.type;
      const finalConfig =
        'config' in body
          ? storedConfig(body.config)
          : (current.config as CreateSectionBody['config']);
      assertTypeMatchesConfig(finalType, finalConfig);
      if ('config' in body) await assertLookProducts(tx, finalConfig);
      const data: Prisma.HomeSectionUncheckedUpdateInput = {};
      if (body.type !== undefined) data.type = body.type;
      if (body.title !== undefined) data.title = body.title;
      if ('subtitle' in body) data.subtitle = body.subtitle ?? null;
      if ('config' in body) data.config = configValue(finalConfig);
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
      if (body.isVisible !== undefined) data.isVisible = body.isVisible;

      const res = await tx.homeSection.updateMany({
        where: { id, updatedAt: body.expectedUpdatedAt },
        data,
      });
      if (res.count !== 1) throw staleUpdate(current);
      if ('config' in body) {
        const oldKey = lookKey(current.config);
        const newKey = lookKey(finalConfig);
        const sync = await syncImages(
          tx,
          oldKey ? [oldKey] : [],
          newKey ? [newKey] : [],
          'admin',
          ctx,
        );
        release = sync.release; // a replaced photo is released after the commit
      }
      return tx.homeSection.findUniqueOrThrow({ where: { id } });
    });
    auditLook(ctx, 'section.look.save', row.id, row.config);
    return { section: await withProducts(toSection(row)), release };
  } catch (err) {
    if (isWriteConflict(err)) {
      const current = await prisma.homeSection.findUnique({ where: { id } });
      throw current ? staleUpdate(current) : notFound();
    }
    throw err;
  }
}

export async function remove(
  id: string,
  ctx: SaveContext,
): Promise<{ release: () => Promise<void> }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  return prisma.$transaction(async (tx) => {
    const current = await tx.homeSection.findUnique({ where: { id } });
    if (!current) throw notFound();
    await tx.homeSection.delete({ where: { id } });
    const key = lookKey(current.config);
    const sync = await syncImages(tx, key ? [key] : [], [], 'admin', ctx);
    if (key) auditLook(ctx, 'section.look.delete', id, current.config); // only a look is audited
    return { release: sync.release }; // the photo's R2 object is released after the commit
  });
}

/** `ids` must be exactly the set of existing section ids; `sortOrder` becomes the list position. */
export async function reorder(ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.homeSection.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((s) => s.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw validation('ids must contain every existing section id exactly once');
    }
    for (const [index, id] of ids.entries()) {
      await tx.homeSection.update({ where: { id }, data: { sortOrder: index + 1 } });
    }
  });
}
