import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { createTestHooks } from '../../lib/testHooks.js';
import { toProduct } from '../products/service.js';

export const MAX_WISHLIST = 100; // owner 2026-11-24 (SRC-008.9)
const WRITE_ATTEMPTS = 3;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Product not found');
const isP2002 = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

/** Test-only interleaving point between the read and the conditional write (same pattern as the cart). */
export const testHooks = createTestHooks<{ beforeWrite?: (attempt: number) => Promise<void> }>();

/**
 * Applies `mutate` to the stored ids under optimistic concurrency on `Wishlist.version`: the write is
 * conditional on (userId, version) and sets version + 1; on a conflict the list is re-read and `mutate`
 * re-applied, up to 3 attempts, then 409 WISHLIST_CONFLICT. `mutate` may throw an AppError.
 */
async function writeList(
  userId: string,
  mutate: (ids: readonly string[]) => string[],
): Promise<void> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const row = await prisma.wishlist.findUnique({ where: { userId } });
    const productIds = mutate(row?.productIds ?? []);
    await testHooks.beforeWrite?.(attempt);
    try {
      if (!row) {
        await prisma.wishlist.create({ data: { userId, productIds, version: 0 } });
        return;
      }
      const res = await prisma.wishlist.updateMany({
        where: { userId, version: row.version },
        data: { productIds, version: row.version + 1 },
      });
      if (res.count === 1) return;
    } catch (err) {
      // A concurrent first write created the row (unique userId) or the engine aborted: retry.
      if (!isP2002(err) && !isWriteConflict(err)) throw err;
    }
  }
  throw new AppError(
    409,
    'WISHLIST_CONFLICT',
    'The favourites were changed concurrently; retry the request',
  );
}

/** Ids (from `ids`) that belong to a PUBLISHED product. */
async function publishedAmong(ids: readonly string[]): Promise<Set<string>> {
  const valid = [...new Set(ids.filter((id) => OBJECT_ID.test(id)))];
  if (!valid.length) return new Set();
  const rows = await prisma.product.findMany({
    where: { id: { in: valid }, status: 'PUBLISHED' },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/** Stored ids that no longer point at a PUBLISHED product (pruned on the next write). */
async function deadIds(userId: string): Promise<Set<string>> {
  const row = await prisma.wishlist.findUnique({ where: { userId } });
  const stored = row?.productIds ?? [];
  const alive = await publishedAmong(stored);
  return new Set(stored.filter((id) => !alive.has(id)));
}

/** GET: PUBLISHED favourites only, newest first. Never rewrites the stored list. */
export async function getWishlist(userId: string) {
  const row = await prisma.wishlist.findUnique({ where: { userId } });
  const stored = [...(row?.productIds ?? [])].reverse(); // stored oldest -> newest
  const products = stored.length
    ? await prisma.product.findMany({
        where: { id: { in: stored }, status: 'PUBLISHED' },
        include: { category: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = stored.flatMap((id) => {
    const p = byId.get(id);
    return p ? [toProduct(p)] : [];
  });
  return { productIds: items.map((p) => p.id), items, total: items.length };
}

/** PUT /me/wishlist/{productId}: idempotent add. */
export async function add(userId: string, productId: string) {
  if (!OBJECT_ID.test(productId)) throw notFound();
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.status !== 'PUBLISHED') throw notFound();
  const dead = await deadIds(userId);
  await writeList(userId, (stored) => {
    const ids = stored.filter((id) => !dead.has(id));
    if (ids.includes(productId)) return ids;
    if (ids.length >= MAX_WISHLIST) {
      throw new AppError(
        409,
        'WISHLIST_LIMIT_REACHED',
        `Favourites hold at most ${MAX_WISHLIST} products`,
      );
    }
    return [...ids, productId];
  });
  return getWishlist(userId);
}

/** DELETE /me/wishlist/{productId}: idempotent remove (also for malformed, unknown or unsaved ids). */
export async function remove(userId: string, productId: string) {
  await writeList(userId, (stored) => stored.filter((id) => id !== productId));
  return getWishlist(userId);
}

/** DELETE /me/wishlist: clear everything (idempotent). */
export async function clear(userId: string): Promise<void> {
  await writeList(userId, () => []);
}

/**
 * POST /me/wishlist/merge: idempotent union. Existing (live) ids first, then the given ids in the given
 * order; duplicates, malformed, unknown and non-PUBLISHED ids are skipped; the result is cut at 100.
 */
export async function merge(userId: string, body: { productIds: string[] }) {
  const alive = await publishedAmong(body.productIds);
  const wanted = [...new Set(body.productIds.filter((id) => alive.has(id)))];
  const skipped = body.productIds.length - wanted.length;
  const dead = await deadIds(userId);
  let truncated = 0;
  let result: string[] = [];
  await writeList(userId, (stored) => {
    const ids = stored.filter((id) => !dead.has(id));
    const have = new Set(ids);
    const fresh = wanted.filter((id) => !have.has(id));
    const room = Math.max(0, MAX_WISHLIST - ids.length);
    truncated = Math.max(0, fresh.length - room);
    result = [...ids, ...fresh.slice(0, room)];
    return result;
  });
  return { productIds: [...result].reverse(), total: result.length, skipped, truncated };
}
