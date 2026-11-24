import { Prisma, type OrderStatus } from '@prisma/client';
import { assertActiveCity } from '../../lib/deliveryCities.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { emitOrderEvent } from '../../lib/orderEvents.js';
import { normalizeSaudiPhone } from '../../lib/phone.js';
import { riyadhDayStart } from '../../lib/riyadhTime.js';
import { computePricing, type PricingResult } from '../../lib/pricing.js';
import { prisma } from '../../lib/prisma.js';
import { db, hit, isDuplicateKey, limitKey } from '../../lib/rateLimit.js';
import { escapeRegex } from '../../lib/searchText.js';
import { createTestHooks } from '../../lib/testHooks.js';
import { consumeCartLines } from '../cart/service.js';
import type { AdminListOrdersQuery, ListOrdersQuery, PlaceOrderBody } from './schema.js';

/**
 * ORD-01 place order + ORD-02 my orders (T-013). All owner decisions 2026-11-22: idempotency via
 * the Idempotency-Key header, expectedTotal required, price included in the stock-decrement
 * where-clause, COD abuse limits, Asia/Riyadh orderNo counter.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/;
const PLACE_ATTEMPTS = 3;
/** COD abuse limits (owner 2026-11-22, PRD ORD-01). */
const MAX_ORDERS_PER_HOUR = 3;
const ORDERS_WINDOW_SECONDS = 3600;
const MAX_PENDING_ORDERS = 3;

interface Ctx {
  log?: Pick<Logger, 'error'>;
  requestId?: string;
}

const orderNotFound = () => new AppError(404, 'NOT_FOUND', 'Order not found');
const addressNotFound = () => new AppError(404, 'NOT_FOUND', 'Address not found');

/** Thrown inside the transaction when a conditional stock decrement matched nothing (stock or price moved). */
class PlacementRetry extends Error {
  constructor(public readonly productId: string) {
    super('placement retry');
    this.name = 'PlacementRetry';
  }
}

const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Test-only (ORD-01 race tests): awaited after validation/pricing and the orderNo, right before the
 * transaction, so tests can change a price or the cart deterministically in the gap. Guarded by
 * `createTestHooks` (owner 2026-11-22): inert unless NODE_ENV === 'test', setting outside test
 * mode throws, and nothing maps HTTP input or env vars onto it.
 */
export const testHooks = createTestHooks<{
  beforeTransaction?: (attempt: number) => Promise<void> | void;
  /**
   * T-014 (ADM-04 double-cancel race test): awaited after the status read/validation, right before
   * the transition transaction, so a test can hold one admin request on a stale read while the
   * other commits. Same `createTestHooks` guard: inert outside NODE_ENV === 'test'.
   */
  beforeTransition?: (attempt: number) => Promise<void> | void;
}>();

// ---------------------------------------------------------------- response shaping

export const USER_INCLUDE = {
  user: { select: { id: true, firstName: true, lastName: true, email: true } },
} satisfies Prisma.OrderInclude;

type OrderWithUser = Prisma.OrderGetPayload<{ include: typeof USER_INCLUDE }>;

/**
 * Spec `Order` schema, ADMIN shape. `imageKey`, `idempotencyKey` and `addressId` stay server-side.
 * Customer responses go through `toCustomerOrder` (owner 2026-11-22, T-014): no `adminNote`, and
 * `statusHistory` events reduced to `{status, at}` — `note` and `byUserId` are internal.
 */
export function toOrder(o: OrderWithUser) {
  return {
    id: o.id,
    orderNo: o.orderNo,
    user: o.user,
    items: o.items.map((i) => ({
      productId: i.productId,
      titleSnapshot: i.titleSnapshot,
      sku: i.sku ?? null,
      imageSnapshot: i.imageSnapshot ?? null,
      unitPrice: i.unitPrice,
      qty: i.qty,
      lineTotal: i.lineTotal,
      type: i.type,
      condition: i.condition,
    })),
    address: { ...o.address, notes: o.address.notes ?? null },
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    vat: { ...o.vat, registrationNumber: o.vat.registrationNumber ?? null },
    total: o.total,
    currency: o.currency,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    status: o.status,
    statusHistory: o.statusHistory.map((e) => ({
      status: e.status,
      at: e.at.toISOString(),
      byUserId: e.byUserId ?? null,
      note: e.note ?? null,
    })),
    customerNote: o.customerNote ?? null,
    adminNote: o.adminNote ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

export type OrderResponse = ReturnType<typeof toOrder>;

/** Customer shape (owner 2026-11-22, T-014): internal fields never reach the customer. */
export function toCustomerOrder(o: OrderWithUser) {
  const base: Omit<OrderResponse, 'adminNote'> & { adminNote?: string | null } = toOrder(o);
  delete base.adminNote; // internal, admin responses only
  return {
    ...base,
    statusHistory: o.statusHistory.map((e) => ({ status: e.status, at: e.at.toISOString() })),
  };
}

export type CustomerOrderResponse = ReturnType<typeof toCustomerOrder>;

// ---------------------------------------------------------------- orderNo (daily Counter)

/** Calendar date in Asia/Riyadh (fixed UTC+3, no DST) as YYYYMMDD. */
const riyadhYmd = (now: Date): string =>
  new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '');

/**
 * Next `FX-YYYYMMDD-NNNN`: one atomic findAndModify upsert with `$inc` on the unique `Counter.name`
 * (`orderNo:{YYYYMMDD}`), an E11000 race on the first upsert retried once (T-024 pattern). Taken
 * before the transaction: a failed placement leaves a gap, which is harmless (`orderNo` is unique).
 */
export async function nextOrderNo(now = new Date()): Promise<string> {
  const ymd = riyadhYmd(now);
  const run = () =>
    db.run({
      findAndModify: 'Counter',
      query: { name: `orderNo:${ymd}` },
      update: { $inc: { seq: 1 } },
      upsert: true,
      new: true,
    });
  let res;
  try {
    res = await run();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    res = await run();
  }
  const seq = (res as { value?: { seq?: unknown } }).value?.seq;
  if (typeof seq !== 'number') throw new Error('unexpected Counter findAndModify result');
  return `FX-${ymd}-${String(seq).padStart(4, '0')}`;
}

// ---------------------------------------------------------------- validation + pricing

interface PrepLine {
  productId: string;
  titleSnapshot: { en: string; ar: string };
  sku: string | null;
  imageSnapshot: string | null;
  imageKey: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
}

interface Prep {
  lines: PrepLine[];
  cartVersion: number;
  addressId: string;
  addressSnapshot: Prisma.AddressSnapshotCreateInput;
  pricing: PricingResult;
  itemExtras: Map<
    string,
    { type: 'NEW' | 'RESALE'; condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' }
  >;
}

/**
 * Re-validates everything from a fresh read (no writes): own address (404) in an active city (422,
 * ADR-008), a non-empty cart (409 CART_EMPTY), every line orderable (409 OUT_OF_STOCK with
 * `details.items`), and the server total equal to `expectedTotal` (409 PRICE_CHANGED; the
 * `details.items` price diff against the cart's `priceSeen` is display-only — owner 2026-11-22).
 */
async function prepare(userId: string, body: PlaceOrderBody): Promise<Prep> {
  if (!OBJECT_ID.test(body.addressId)) throw addressNotFound();
  const address = await prisma.address.findFirst({ where: { id: body.addressId, userId } });
  if (!address) throw addressNotFound();
  const city = await assertActiveCity(address.cityCode); // 422 OUT_OF_DELIVERY_AREA before any write

  const [cart, settings] = await Promise.all([
    prisma.cart.findUnique({ where: { userId } }),
    prisma.siteSetting.findUnique({ where: { key: 'default' } }),
  ]);
  const items = cart?.items ?? [];
  if (items.length === 0) throw new AppError(409, 'CART_EMPTY', 'The cart is empty');

  const products = new Map(
    (await prisma.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } })).map(
      (p) => [p.id, p],
    ),
  );
  const failing = items.flatMap((line) => {
    const p = products.get(line.productId);
    if (!p || p.status !== 'PUBLISHED') return [{ productId: line.productId, stock: 0 }];
    return line.qty > p.stock ? [{ productId: line.productId, stock: p.stock }] : [];
  });
  if (failing.length > 0) {
    throw new AppError(
      409,
      'OUT_OF_STOCK',
      'Some items are no longer available in the requested quantity',
      {
        items: failing,
      },
    );
  }

  const pricing = computePricing({
    lines: items.map((line) => ({ unitPrice: products.get(line.productId)!.price, qty: line.qty })),
    city: { deliveryFee: city.deliveryFee ?? null },
    settings: {
      deliveryFee: settings?.deliveryFee ?? 0,
      freeDeliveryThreshold: settings?.freeDeliveryThreshold ?? null,
      vat: settings?.vat ?? {
        vatRate: 0,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
    },
  });

  if (pricing.total !== body.expectedTotal) {
    throw new AppError(409, 'PRICE_CHANGED', 'The totals changed; review your cart and try again', {
      expectedTotal: body.expectedTotal,
      total: pricing.total,
      items: items.flatMap((line) => {
        const live = products.get(line.productId)!.price;
        return live === line.priceSeen
          ? []
          : [{ productId: line.productId, oldPrice: line.priceSeen, newPrice: live }];
      }),
    });
  }

  const itemExtras = new Map(
    items.map((line) => {
      const p = products.get(line.productId)!;
      return [line.productId, { type: p.type, condition: p.condition }] as const;
    }),
  );
  return {
    lines: items.map((line, i) => {
      const p = products.get(line.productId)!;
      const image = p.images[0] ?? null;
      return {
        productId: line.productId,
        titleSnapshot: { en: p.title.en, ar: p.title.ar },
        sku: p.sku ?? null,
        imageSnapshot: image?.url ?? null,
        imageKey: image?.key ?? null,
        unitPrice: p.price,
        qty: line.qty,
        lineTotal: pricing.lines[i]!.lineTotal,
      };
    }),
    cartVersion: cart!.version,
    addressId: address.id,
    addressSnapshot: {
      fullName: address.fullName,
      phone: address.phone,
      cityCode: address.cityCode,
      city: { en: city.name.en, ar: city.name.ar },
      area: address.area,
      street: address.street,
      notes: address.notes ?? null,
    },
    pricing,
    itemExtras,
  };
}

// ---------------------------------------------------------------- COD abuse limits (owner 2026-11-22)

async function assertLimits(userId: string, ctx: Ctx): Promise<void> {
  // The PENDING cap is read first so a capped user never consumes an hourly slot.
  const pending = await prisma.order.count({ where: { userId, status: 'PENDING' } });
  if (pending >= MAX_PENDING_ORDERS) {
    throw new AppError(
      409,
      'TOO_MANY_PENDING_ORDERS',
      `You already have ${MAX_PENDING_ORDERS} pending orders`,
      { pending },
    );
  }
  const r = await hit(
    limitKey('orders', 'user', userId),
    MAX_ORDERS_PER_HOUR,
    ORDERS_WINDOW_SECONDS,
    ctx,
  );
  if (!r.allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many orders; try again later', {
      retryAfterSeconds: r.retryAfterSeconds,
    });
  }
}

// ---------------------------------------------------------------- idempotency (owner 2026-11-22)

/**
 * Returns the already-created order for (userId, Idempotency-Key), or null. The same key with a
 * different `addressId` or `expectedTotal` -> 422 IDEMPOTENCY_MISMATCH (the stored order's `total`
 * always equals the `expectedTotal` it was created with).
 */
async function findReplay(
  userId: string,
  key: string,
  body: PlaceOrderBody,
): Promise<OrderWithUser | null> {
  const existing = await prisma.order.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
    include: USER_INCLUDE,
  });
  if (!existing) return null;
  if (existing.addressId !== body.addressId || existing.total !== body.expectedTotal) {
    throw new AppError(
      422,
      'IDEMPOTENCY_MISMATCH',
      'This Idempotency-Key was already used with a different addressId or expectedTotal',
    );
  }
  return existing;
}

// ---------------------------------------------------------------- ORD-01 place order

export interface PlaceOrderResult {
  order: OrderWithUser;
  /** true -> respond 200 (idempotent replay) instead of 201. */
  replay: boolean;
}

export async function placeOrder(
  userId: string,
  body: PlaceOrderBody,
  key: string,
  ctx: Ctx = {},
): Promise<PlaceOrderResult> {
  const replayed = await findReplay(userId, key, body);
  if (replayed) return { order: replayed, replay: true };
  try {
    return await placeNew(userId, body, key, ctx);
  } catch (err) {
    // Idempotency trumps any placement failure: when a concurrent duplicate with the same key won
    // meanwhile, its committed order also cleared the cart, so the loser's retry would otherwise
    // surface a misleading error (e.g. CART_EMPTY). An order with this key = the request succeeded.
    if (err instanceof AppError && err.code === 'IDEMPOTENCY_MISMATCH') throw err;
    const winner = await findReplay(userId, key, body).catch(() => null);
    if (winner) return { order: winner, replay: true };
    throw err;
  }
}

async function placeNew(
  userId: string,
  body: PlaceOrderBody,
  key: string,
  ctx: Ctx,
): Promise<PlaceOrderResult> {
  let counted = false;
  for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt++) {
    const prep = await prepare(userId, body); // throws the precise 404/422/409 on every attempt
    if (!counted) {
      await assertLimits(userId, ctx);
      counted = true; // one slot per placement request, not per retry
    }
    const orderNo = await nextOrderNo();
    await testHooks.beforeTransaction?.(attempt);
    try {
      const now = new Date();
      const { order, cleared } = await prisma.$transaction(async (tx) => {
        // Stock consistency (system-architecture.md#stock-consistency) + price race (owner
        // 2026-11-22): the where-clause pins status, stock AND the unitPrice used for pricing.
        for (const line of prep.lines) {
          const res = await tx.product.updateMany({
            where: {
              id: line.productId,
              status: 'PUBLISHED',
              stock: { gte: line.qty },
              price: line.unitPrice,
            },
            data: { stock: { decrement: line.qty } },
          });
          if (res.count === 0) throw new PlacementRetry(line.productId);
        }
        const created = await tx.order.create({
          data: {
            orderNo,
            userId,
            idempotencyKey: key,
            addressId: prep.addressId,
            items: prep.lines.map((line) => ({
              productId: line.productId,
              titleSnapshot: line.titleSnapshot,
              sku: line.sku,
              imageSnapshot: line.imageSnapshot,
              imageKey: line.imageKey,
              unitPrice: line.unitPrice,
              qty: line.qty,
              lineTotal: line.lineTotal,
              type: prep.itemExtras.get(line.productId)!.type,
              condition: prep.itemExtras.get(line.productId)!.condition,
            })),
            address: prep.addressSnapshot,
            subtotal: prep.pricing.subtotal,
            deliveryFee: prep.pricing.deliveryFee,
            vat: prep.pricing.vat,
            total: prep.pricing.total,
            currency: 'SAR',
            paymentMethod: 'COD',
            paymentStatus: 'UNPAID',
            status: 'PENDING',
            statusHistory: [{ status: 'PENDING', at: now, byUserId: userId, note: null }],
            customerNote: body.customerNote ? body.customerNote : null,
            adminNote: null,
          },
          include: USER_INCLUDE,
        });
        // Version-conditional clear: only the cart state the order was built from is wiped.
        const wiped = await tx.cart.updateMany({
          where: { userId, version: prep.cartVersion },
          data: { items: [], version: prep.cartVersion + 1 },
        });
        return { order: created, cleared: wiped.count === 1 };
      });
      if (!cleared) {
        // The cart moved between read and transaction: remove only the ordered quantities, so a
        // concurrent PUT during checkout is never lost.
        await consumeCartLines(
          userId,
          prep.lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          ctx,
        );
      }
      emitOrderEvent('order.created', order, ctx); // after commit only (owner 2026-11-22)
      return { order, replay: false };
    } catch (err) {
      if (err instanceof PlacementRetry || isWriteConflict(err)) continue; // fresh read, re-price
      if (isUniqueViolation(err)) {
        // Concurrent duplicate with the same Idempotency-Key lost the unique index: the whole
        // transaction (including the decrements) rolled back; return the winner's order.
        const winner = await findReplay(userId, key, body);
        if (winner) return { order: winner, replay: true };
      }
      throw err;
    }
  }
  // Retries exhausted. A final validation pass surfaces the real cause (OUT_OF_STOCK /
  // PRICE_CHANGED); if it passes, the contention was transient and the client may simply retry.
  await prepare(userId, body);
  throw new AppError(
    409,
    'CONFLICT',
    'The order could not be placed due to concurrent updates; please try again',
  );
}

// ---------------------------------------------------------------- ORD-02 my orders

const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

export async function listMyOrders(userId: string, query: ListOrdersQuery) {
  const where = { userId };
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: USER_INCLUDE,
    }),
    prisma.order.count({ where }),
  ]);
  return { items: rows.map(toCustomerOrder), meta: pageMeta(query.page, query.limit, total) };
}

export async function getMyOrder(userId: string, id: string): Promise<CustomerOrderResponse> {
  if (!OBJECT_ID.test(id)) throw orderNotFound();
  const order = await prisma.order.findFirst({ where: { id, userId }, include: USER_INCLUDE });
  if (!order) throw orderNotFound();
  return toCustomerOrder(order);
}

// ---------------------------------------------------------------- ADM-04 admin orders (T-014)

/** Transition matrix (owner 2026-11-22): any non-terminal status can be cancelled (COD). */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

/**
 * Customer matrix (ORD-03, T-015): a customer may only cancel an own PENDING order. Kept as a full
 * matrix so the transition core applies it exactly like the admin one — on every fresh read inside
 * the retry loop, so a concurrent admin CONFIRM turns a customer cancel into a 409, never a cancel
 * of a CONFIRMED order.
 */
const CUSTOMER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING: ['CANCELLED'],
  CONFIRMED: [],
  PROCESSING: [],
  OUT_FOR_DELIVERY: [],
  DELIVERED: [],
  CANCELLED: [],
};

const TRANSITION_ATTEMPTS = 3;

const invalidTransition = (from: OrderStatus, to: OrderStatus, allowed: readonly OrderStatus[]) =>
  new AppError(409, 'INVALID_TRANSITION', `Cannot change order status from ${from} to ${to}`, {
    from,
    to,
    allowed,
  });

export async function listAdminOrders(query: AdminListOrdersQuery) {
  const where: Prisma.OrderWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: riyadhDayStart(query.from) } : {}),
      // Inclusive end: strictly before the start of the following Riyadh day.
      ...(query.to ? { lt: new Date(riyadhDayStart(query.to).getTime() + 86_400_000) } : {}),
    };
  }
  if (query.q) {
    // Rule 9: Prisma MongoDB contains/insensitive is $regex-backed -> always escaped, max 100 chars.
    const literal = escapeRegex(query.q);
    const or: Prisma.OrderWhereInput[] = [{ orderNo: { contains: literal, mode: 'insensitive' } }];
    const users = await prisma.user.findMany({
      where: { email: { contains: literal, mode: 'insensitive' } },
      select: { id: true },
      take: 200,
    });
    if (users.length > 0) or.push({ userId: { in: users.map((u) => u.id) } });
    // Owner 2026-11-22: a query that normalises to a Saudi mobile (T-020, incl. Arabic-Indic
    // digits) also matches the order's snapshot phone exactly (canonical form, no regex).
    const phone = normalizeSaudiPhone(query.q);
    if (phone) or.push({ address: { is: { phone } } });
    where.OR = or;
  }
  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: USER_INCLUDE,
    }),
    prisma.order.count({ where }),
  ]);
  return { items: rows.map(toOrder), meta: pageMeta(query.page, query.limit, total) };
}

export async function getAdminOrder(id: string): Promise<OrderResponse> {
  if (!OBJECT_ID.test(id)) throw orderNotFound();
  const order = await prisma.order.findUnique({ where: { id }, include: USER_INCLUDE });
  if (!order) throw orderNotFound();
  return toOrder(order);
}

/** Thrown inside the transaction when the conditional status write matched nothing (status moved). */
class TransitionRetry extends Error {
  constructor() {
    super('transition retry');
    this.name = 'TransitionRetry';
  }
}

interface TransitionOpts {
  /** Restrict every read and the conditional write to this owner's orders; a miss (including a foreign order) is a 404, so ownership is never revealed (ORD-03). */
  ownerId?: string;
  /** Allowed transitions for this caller (default: the admin `TRANSITIONS` matrix); re-checked on every fresh read inside the retry loop. */
  transitions?: Readonly<Record<OrderStatus, readonly OrderStatus[]>>;
}

/**
 * Shared status-transition core (ADM-04 admin, ORD-03 customer cancel; owner 2026-11-22): ONE
 * conditional write — `where {id, status: <just read>}` — inside a transaction, so a concurrent
 * transition can never apply twice (a double-cancel, admin + customer included, restores stock
 * exactly once). DELIVERED also sets `paymentStatus: PAID`; CANCELLED restores stock per item in
 * the same transaction and leaves `paymentStatus` UNPAID. Every transition appends a
 * `StatusEvent {status, at, byUserId, note}`. `order.statusChanged` is emitted after commit only,
 * with `{orderId, from, to, byUserId}` (reused by T-016).
 */
async function applyTransition(
  id: string,
  target: OrderStatus,
  note: string | undefined,
  byUserId: string,
  ctx: Ctx,
  opts: TransitionOpts = {},
): Promise<OrderWithUser> {
  const matrix = opts.transitions ?? TRANSITIONS;
  const owner = opts.ownerId ? { userId: opts.ownerId } : {};
  if (!OBJECT_ID.test(id)) throw orderNotFound();
  for (let attempt = 0; attempt < TRANSITION_ATTEMPTS; attempt++) {
    const order = await prisma.order.findFirst({ where: { id, ...owner } });
    if (!order) throw orderNotFound();
    const from = order.status;
    if (!matrix[from].includes(target)) throw invalidTransition(from, target, matrix[from]);
    await testHooks.beforeTransition?.(attempt);
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const res = await tx.order.updateMany({
          where: { id, ...owner, status: from },
          data: {
            status: target,
            ...(target === 'DELIVERED' ? { paymentStatus: 'PAID' as const } : {}),
            statusHistory: {
              push: { status: target, at: new Date(), byUserId, note: note ?? null },
            },
          },
        });
        if (res.count === 0) throw new TransitionRetry();
        if (target === 'CANCELLED') {
          for (const item of order.items) {
            const restored = await tx.product.updateMany({
              where: { id: item.productId },
              data: { stock: { increment: item.qty } },
            });
            if (restored.count === 0) {
              // Products in orders are archived, never hard-deleted (T-010); tolerate the
              // impossible case without failing the cancel.
              ctx.log?.error(
                { requestId: ctx.requestId, orderId: id, productId: item.productId },
                'stock restore skipped: product row missing',
              );
            }
          }
        }
        return tx.order.findUniqueOrThrow({ where: { id }, include: USER_INCLUDE });
      });
      emitOrderEvent('order.statusChanged', updated, ctx, {
        orderId: id,
        from,
        to: target,
        byUserId,
      });
      return updated;
    } catch (err) {
      // A concurrent transition won (conditional write matched nothing, or a Mongo write
      // conflict): re-read and re-decide — usually a 409 against the fresh status.
      if (err instanceof TransitionRetry || isWriteConflict(err)) continue;
      throw err;
    }
  }
  const fresh = await prisma.order.findFirst({ where: { id, ...owner } });
  if (!fresh) throw orderNotFound();
  throw invalidTransition(fresh.status, target, matrix[fresh.status]);
}

/** ADM-04 (T-014): admin status transition over the full matrix. */
export async function transitionStatus(
  id: string,
  target: OrderStatus,
  note: string | undefined,
  byUserId: string,
  ctx: Ctx = {},
): Promise<OrderResponse> {
  return toOrder(await applyTransition(id, target, note, byUserId, ctx));
}

/**
 * ORD-03 (T-015): customer cancels an own PENDING order. Foreign/unknown order -> 404; any other
 * status -> 409 INVALID_TRANSITION (CUSTOMER_TRANSITIONS, enforced per fresh read). The StatusEvent
 * records `byUserId` = the customer and `note` = the optional trimmed cancel reason (or null) —
 * admin-visible only: `toCustomerOrder` strips it and the ORD-04 email templates never render it.
 */
export async function cancelOwnOrder(
  userId: string,
  id: string,
  reason: string | undefined,
  ctx: Ctx = {},
): Promise<CustomerOrderResponse> {
  const updated = await applyTransition(id, 'CANCELLED', reason, userId, ctx, {
    ownerId: userId,
    transitions: CUSTOMER_TRANSITIONS,
  });
  return toCustomerOrder(updated);
}

export async function setAdminNote(id: string, adminNote: string | null): Promise<OrderResponse> {
  if (!OBJECT_ID.test(id)) throw orderNotFound();
  const existing = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw orderNotFound();
  const order = await prisma.order.update({
    where: { id },
    data: { adminNote },
    include: USER_INCLUDE,
  });
  return toOrder(order);
}
