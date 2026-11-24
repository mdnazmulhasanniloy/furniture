import { Prisma, type Banner } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { buildImageAsset, syncImages, type R2Context } from '../../lib/r2.js';
import type { CreateBannerBody, UpdateBannerBody } from './schema.js';

type BannerImageBody = NonNullable<CreateBannerBody['imageMobile']>;
/** Alt text and the optional focal point travel with the key (CR-011). */
const assetOf = (img: BannerImageBody) =>
  buildImageAsset(img.key, {
    alt: img.alt,
    ...(img.focalX !== undefined ? { focalX: img.focalX, focalY: img.focalY } : {}),
  });

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Banner not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

export type SaveContext = R2Context & { uploadedById: string };
const noRelease = async () => {};

export const toBanner = (b: Banner) => ({
  id: b.id,
  title: b.title,
  subtitle: b.subtitle ?? null,
  ctaLabel: b.ctaLabel ?? null,
  ctaHref: b.ctaHref ?? null,
  imageDesktop: b.imageDesktop,
  imageMobile: b.imageMobile ?? null,
  startsAt: b.startsAt ?? null,
  endsAt: b.endsAt ?? null,
  sortOrder: b.sortOrder,
  isActive: b.isActive,
  updatedAt: b.updatedAt,
});
export type BannerResponse = ReturnType<typeof toBanner>;

const staleUpdate = (current: Banner) =>
  new AppError(409, 'STALE_UPDATE', 'The banner was changed by someone else; reload and retry', {
    current: toBanner(current),
  });

/** Checked on the merged result (owner 2026-11-22): an active schedule window must be non-empty. */
function assertSchedule(startsAt: Date | null, endsAt: Date | null): void {
  if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
    throw validation('startsAt must be before endsAt');
  }
}

const keysOf = (...images: ({ key: string } | null)[]): string[] =>
  images.filter((i): i is { key: string } => i !== null).map((i) => i.key);

export async function list(): Promise<BannerResponse[]> {
  const rows = await prisma.banner.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toBanner);
}

export async function create(body: CreateBannerBody, ctx: SaveContext): Promise<BannerResponse> {
  assertSchedule(body.startsAt ?? null, body.endsAt ?? null);
  const imageDesktop = assetOf(body.imageDesktop);
  const imageMobile = body.imageMobile ? assetOf(body.imageMobile) : null;
  const row = await prisma.$transaction(async (tx) => {
    await syncImages(tx, [], keysOf(imageDesktop, imageMobile), 'admin', ctx);
    return tx.banner.create({
      data: {
        title: body.title,
        imageDesktop,
        // Optional fields are written as explicit null (null-vs-missing, CLAUDE.md rule 8).
        imageMobile,
        subtitle: body.subtitle ?? null,
        ctaLabel: body.ctaLabel ?? null,
        ctaHref: body.ctaHref ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
        sortOrder: body.sortOrder ?? 0,
        isActive: body.isActive ?? true,
      },
    });
  });
  return toBanner(row);
}

export async function update(
  id: string,
  body: UpdateBannerBody,
  ctx: SaveContext,
): Promise<{ banner: BannerResponse; release: () => Promise<void> }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let release = noRelease;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.banner.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      assertSchedule(
        'startsAt' in body ? (body.startsAt ?? null) : (current.startsAt ?? null),
        'endsAt' in body ? (body.endsAt ?? null) : (current.endsAt ?? null),
      );

      const nextDesktop = body.imageDesktop ? assetOf(body.imageDesktop) : current.imageDesktop;
      const nextMobile =
        'imageMobile' in body
          ? body.imageMobile
            ? assetOf(body.imageMobile)
            : null
          : (current.imageMobile ?? null);
      const sync = await syncImages(
        tx,
        keysOf(current.imageDesktop, current.imageMobile ?? null),
        keysOf(nextDesktop, nextMobile),
        'admin',
        ctx,
      );
      release = sync.release;

      const data: Prisma.BannerUncheckedUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if ('subtitle' in body) data.subtitle = body.subtitle ?? null;
      if ('ctaLabel' in body) data.ctaLabel = body.ctaLabel ?? null;
      if ('ctaHref' in body) data.ctaHref = body.ctaHref ?? null;
      if ('startsAt' in body) data.startsAt = body.startsAt ?? null;
      if ('endsAt' in body) data.endsAt = body.endsAt ?? null;
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
      if (body.isActive !== undefined) data.isActive = body.isActive;
      if (body.imageDesktop !== undefined) data.imageDesktop = nextDesktop;
      if ('imageMobile' in body) data.imageMobile = nextMobile;

      // One conditional write: nothing matches when someone saved in between -> 409, nothing changed.
      const res = await tx.banner.updateMany({
        where: { id, updatedAt: body.expectedUpdatedAt },
        data,
      });
      if (res.count !== 1) throw staleUpdate(current);
      return tx.banner.findUniqueOrThrow({ where: { id } });
    });
    return { banner: toBanner(row), release };
  } catch (err) {
    // The transaction rolled back: the caller never gets (and never calls) release.
    if (isWriteConflict(err)) {
      const current = await prisma.banner.findUnique({ where: { id } });
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
  let release = noRelease;
  await prisma.$transaction(async (tx) => {
    const current = await tx.banner.findUnique({ where: { id } });
    if (!current) throw notFound();
    const sync = await syncImages(
      tx,
      keysOf(current.imageDesktop, current.imageMobile ?? null),
      [],
      'admin',
      ctx,
    );
    release = sync.release;
    await tx.banner.delete({ where: { id } });
  });
  return { release };
}

/** CR-011: `ids` must be exactly the set of existing banner ids; `sortOrder` becomes the list position (1 to n). All or nothing. */
export async function reorder(ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.banner.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((b) => b.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw validation('ids must contain every existing banner id exactly once');
    }
    for (const [index, id] of ids.entries()) {
      await tx.banner.update({ where: { id }, data: { sortOrder: index + 1 } });
    }
  });
}
