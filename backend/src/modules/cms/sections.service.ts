import { Prisma, type HomeSection } from '@prisma/client';
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
  const { key, alt } = config.look.image;
  return {
    ...config,
    look: { ...config.look, image: buildImageAsset(key, { alt }) },
  } as CreateSectionBody['config'];
}

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
  return rows.map(toSection);
}

export async function create(body: CreateSectionBody, ctx: SaveContext): Promise<SectionResponse> {
  assertTypeMatchesConfig(body.type, body.config);
  const config = storedConfig(body.config);
  const key = lookKey(config);
  const row = await prisma.$transaction(async (tx) => {
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
  return toSection(row);
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
    return { section: toSection(row), release };
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
