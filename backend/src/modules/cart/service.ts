import { Prisma, type CartItem } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { computePricing, type PricingCity } from '../../lib/pricing.js';
import { prisma } from '../../lib/prisma.js';
import { createTestHooks } from '../../lib/testHooks.js';
import { toProduct, type ProductResponse } from '../products/service.js';
import type { GetCartQuery, MergeBody, PutItemBody } from './schema.js';

export const MAX_CART_LINES = 50; // owner 2026-11-22
const WRITE_ATTEMPTS = 3;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const productNotFound = () => new AppError(404, 'NOT_FOUND', 'Product not found');
const addressNotFound = () => new AppError(404, 'NOT_FOUND', 'Address not found');
const cartConflict = () =>
  new AppError(409, 'CART_CONFLICT', 'The cart was changed concurrently; retry the request');
const isP2002 = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

type Issue = 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'QTY_REDUCED' | 'PRICE_CHANGED' | null;

export interface CartItemResponse {
  product: ProductResponse | null;
  /** Effective quantity: stored qty capped at live stock; 0 for OUT_OF_STOCK/UNAVAILABLE. */
  qty: number;
  lineTotal: number;
  /** Priority when several apply: UNAVAILABLE > OUT_OF_STOCK > QTY_REDUCED > PRICE_CHANGED. */
  issue: Issue;
  details: { oldPrice: number; newPrice: number } | null;
}

export interface CartResponse {
  items: CartItemResponse[];
  subtotal: number;
  deliveryFee: number;
  vat: {
    vatRate: number;
    vatAmount: number;
    applyToDelivery: boolean;
    pricesIncludeVat: boolean;
    registrationNumber: string | null;
  };
  total: number;
  address: { id: string; cityCode: string; isDeliverable: boolean } | null;
}

// ---------------------------------------------------------------- optimistic-concurrent writes

/**
 * Test-only (CART-01 concurrency): when set, awaited between the cart read and the conditional
 * write, so tests can interleave two writers deterministically. Guarded by `createTestHooks`
 * (owner 2026-11-22): inert unless NODE_ENV === 'test', setting outside test mode throws, and
 * nothing maps HTTP input or env vars onto it.
 */
export const testHooks = createTestHooks<{ beforeWrite?: (attempt: number) => Promise<void> }>();

/**
 * Applies `mutate` to the user's cart items under optimistic concurrency on `Cart.version`
 * (owner 2026-11-22): the write is conditional on (userId, version) and sets version + 1; on a
 * conflict the cart is re-read and `mutate` re-applied, up to 3 attempts, then 409 CART_CONFLICT.
 * `mutate` may throw an AppError (limit/stock checks run against the freshly read items).
 */
async function writeCart(
  userId: string,
  mutate: (items: readonly CartItem[]) => CartItem[],
): Promise<void> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const cart = await prisma.cart.findUnique({ where: { userId } });
    const items = mutate(cart?.items ?? []);
    await testHooks.beforeWrite?.(attempt);
    try {
      if (!cart) {
        await prisma.cart.create({ data: { userId, items, version: 0 } });
        return;
      }
      const res = await prisma.cart.updateMany({
        where: { userId, version: cart.version },
        data: { items, version: cart.version + 1 },
      });
      if (res.count === 1) return;
    } catch (err) {
      // Concurrent first write created the cart (unique userId) or the storage engine aborted: retry.
      if (!isP2002(err) && !isWriteConflict(err)) throw err;
    }
  }
  throw cartConflict();
}

/**
 * T-013: when an order's in-transaction cart clear missed (the cart version moved between the
 * placement's read and its transaction), remove exactly the ordered quantities — a concurrent PUT
 * during checkout is never silently lost. Runs after the order committed, so it never throws: a
 * persistent conflict is logged and the cart is left as is (the order stands either way).
 */
export async function consumeCartLines(
  userId: string,
  ordered: readonly { productId: string; qty: number }[],
  ctx: { log?: Pick<Logger, 'error'>; requestId?: string } = {},
): Promise<void> {
  const taken = new Map(ordered.map((l) => [l.productId, l.qty]));
  try {
    await writeCart(userId, (items) =>
      items
        .map((i) => ({ ...i, qty: i.qty - (taken.get(i.productId) ?? 0) }))
        .filter((i) => i.qty > 0),
    );
  } catch (err) {
    ctx.log?.error(
      { err, requestId: ctx.requestId },
      'cart cleanup after order placement failed; cart left unchanged',
    );
  }
}

// ---------------------------------------------------------------- CART-01 writes

/** PUT /cart/items: qty 0 removes; above live stock -> 409 OUT_OF_STOCK; refreshes priceSeen. */
export async function setItem(userId: string, body: PutItemBody): Promise<CartResponse> {
  const product = await prisma.product.findUnique({ where: { id: body.productId } });
  if (!product || product.status !== 'PUBLISHED') throw productNotFound();
  if (body.qty > product.stock) {
    throw new AppError(409, 'OUT_OF_STOCK', 'Requested quantity exceeds the available stock', {
      productId: product.id,
      stock: product.stock,
    });
  }
  await writeCart(userId, (items) => {
    const rest = items.filter((i) => i.productId !== body.productId);
    if (body.qty === 0) return rest;
    if (rest.length >= MAX_CART_LINES && rest.length === items.length) {
      throw new AppError(409, 'CART_LIMIT_REACHED', `A cart holds at most ${MAX_CART_LINES} items`);
    }
    const line = { productId: product.id, qty: body.qty, priceSeen: product.price };
    return items.some((i) => i.productId === body.productId)
      ? items.map((i) => (i.productId === body.productId ? line : i))
      : [...items, line];
  });
  return getCart(userId, {});
}

/**
 * POST /cart/merge — idempotent (owner 2026-11-22): per product the new qty =
 * max(existing qty, guest qty), capped at live stock; duplicate payload productIds are combined
 * with max; unknown and non-PUBLISHED products are skipped silently. A line whose capped qty would
 * be 0 (sold out) is skipped: an existing line is left unchanged, a new one is not added. Lines
 * beyond the cart limit are dropped (existing lines first). Merged lines refresh `priceSeen`.
 */
export async function merge(userId: string, body: MergeBody): Promise<CartResponse> {
  const wanted = new Map<string, number>();
  for (const { productId, qty } of body.items) {
    wanted.set(productId, Math.max(wanted.get(productId) ?? 0, qty));
  }
  const products = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: [...wanted.keys()] }, status: 'PUBLISHED' },
        select: { id: true, stock: true, price: true },
      })
    ).map((p) => [p.id, p]),
  );
  await writeCart(userId, (items) => {
    const merged = items.map((line) => {
      const guestQty = wanted.get(line.productId);
      const product = products.get(line.productId);
      if (guestQty === undefined || !product) return line;
      const qty = Math.min(Math.max(line.qty, guestQty), product.stock);
      return qty === 0 ? line : { productId: line.productId, qty, priceSeen: product.price };
    });
    const existing = new Set(items.map((i) => i.productId));
    for (const [productId, guestQty] of wanted) {
      const product = products.get(productId);
      if (!product || existing.has(productId) || merged.length >= MAX_CART_LINES) continue;
      const qty = Math.min(guestQty, product.stock);
      if (qty > 0) merged.push({ productId, qty, priceSeen: product.price });
    }
    return merged;
  });
  return getCart(userId, {});
}

// ---------------------------------------------------------------- CART-01 read

interface ResolvedAddress {
  info: { id: string; cityCode: string; isDeliverable: boolean };
  /** Pricing city: the active city's override, or null (base fee) when inactive/unknown. */
  city: PricingCity | null;
}

/** 404 for a malformed, unknown or foreign addressId (T-007 rule). Inactive city -> base fee, isDeliverable false. */
async function resolveAddress(
  userId: string,
  addressId: string,
  cities: { code: string; isActive: boolean; deliveryFee: number | null }[],
): Promise<ResolvedAddress> {
  if (!OBJECT_ID.test(addressId)) throw addressNotFound();
  const address = await prisma.address.findFirst({ where: { id: addressId, userId } });
  if (!address) throw addressNotFound();
  const code = address.cityCode.trim().toLowerCase();
  const city = cities.find((c) => c.code.trim().toLowerCase() === code);
  const isDeliverable = city?.isActive === true;
  return {
    info: { id: address.id, cityCode: address.cityCode, isDeliverable },
    city: isDeliverable ? { deliveryFee: city.deliveryFee ?? null } : null,
  };
}

/**
 * GET /cart — read-only: the stored cart is never rewritten. Only effective lines go to
 * `computePricing` (never qty 0); an empty or fully ineffective cart prices as 0 even when a
 * base fee is set (owner 2026-11-22).
 */
export async function getCart(userId: string, query: GetCartQuery): Promise<CartResponse> {
  const [cart, settings] = await Promise.all([
    prisma.cart.findUnique({ where: { userId } }),
    prisma.siteSetting.findUnique({ where: { key: 'default' } }),
  ]);
  const items = cart?.items ?? [];
  const vatSetting = settings?.vat ?? {
    vatRate: 0,
    applyToDelivery: true,
    pricesIncludeVat: true,
    registrationNumber: null,
  };

  const address =
    query.addressId === undefined
      ? null
      : await resolveAddress(
          userId,
          query.addressId,
          settings?.deliveryCities.map((c) => ({
            code: c.code,
            isActive: c.isActive,
            deliveryFee: c.deliveryFee ?? null,
          })) ?? [],
        );

  const products = new Map(
    (
      await prisma.product.findMany({
        where: { id: { in: items.map((i) => i.productId) } },
        include: { category: true },
      })
    ).map((p) => [p.id, p]),
  );

  const lines = items.map((line): CartItemResponse => {
    const product = products.get(line.productId);
    if (!product || product.status !== 'PUBLISHED') {
      return { product: null, qty: 0, lineTotal: 0, issue: 'UNAVAILABLE', details: null };
    }
    const shaped = toProduct(product);
    if (product.stock === 0) {
      return { product: shaped, qty: 0, lineTotal: 0, issue: 'OUT_OF_STOCK', details: null };
    }
    const qty = Math.min(line.qty, product.stock);
    const issue: Issue =
      qty < line.qty ? 'QTY_REDUCED' : product.price !== line.priceSeen ? 'PRICE_CHANGED' : null;
    return {
      product: shaped,
      qty,
      lineTotal: 0, // filled from computePricing below
      issue,
      details:
        issue === 'PRICE_CHANGED' ? { oldPrice: line.priceSeen, newPrice: product.price } : null,
    };
  });

  const effective = lines.filter((l) => l.qty > 0);
  if (effective.length === 0) {
    return {
      items: lines,
      subtotal: 0,
      deliveryFee: 0,
      vat: {
        vatRate: vatSetting.vatRate,
        vatAmount: 0,
        applyToDelivery: vatSetting.applyToDelivery,
        pricesIncludeVat: vatSetting.pricesIncludeVat,
        registrationNumber: vatSetting.registrationNumber ?? null,
      },
      total: 0,
      address: address?.info ?? null,
    };
  }

  const pricing = computePricing({
    lines: effective.map((l) => ({ unitPrice: l.product!.price, qty: l.qty })),
    city: address?.city ?? null,
    settings: {
      deliveryFee: settings?.deliveryFee ?? 0,
      freeDeliveryThreshold: settings?.freeDeliveryThreshold ?? null,
      vat: vatSetting,
    },
  });
  effective.forEach((line, i) => {
    line.lineTotal = pricing.lines[i]!.lineTotal;
  });

  return {
    items: lines,
    subtotal: pricing.subtotal,
    deliveryFee: pricing.deliveryFee,
    vat: pricing.vat,
    total: pricing.total,
    address: address?.info ?? null,
  };
}
