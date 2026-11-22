import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_orders_t013',
  );
});

import { createApp } from '../../src/app.js';
import { onOrderEvent } from '../../src/lib/orderEvents.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { testHooks } from '../../src/modules/orders/service.js';

const app = createApp();
const BASE = '/api/v1/orders';

/** Same fixed UTC+3 rule as the service (Asia/Riyadh, no DST). */
const riyadhYmd = () =>
  new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '');

let hash = '';
let token = '';
let userId = '';
let otherToken = '';
let otherId = '';
let adminToken = '';
let categoryId = '';
let addressId = '';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

interface PlaceOpts {
  /** null -> send no Idempotency-Key header. */
  key?: string | null;
  t?: string;
}
const place = (body: Record<string, unknown>, opts: PlaceOpts = {}) => {
  const req = request(app)
    .post(BASE)
    .set(auth(opts.t ?? token));
  if (opts.key !== null) req.set('Idempotency-Key', opts.key ?? crypto.randomUUID());
  return req.send(body);
};

const city = (code: string, isActive: boolean, deliveryFee: number | null = null) => ({
  code,
  name: { en: `${code}-en`, ar: `${code}-ar` },
  isActive,
  sortOrder: 1,
  deliveryFee,
});

async function seedSettings(over: Record<string, unknown> = {}) {
  await prisma.siteSetting.deleteMany();
  await prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'a@example.com',
      contactPhone: '+966551234567',
      deliveryFee: 0,
      freeDeliveryThreshold: null,
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
      deliveryCities: [city('riyadh', true), city('jeddah', true, 2500), city('dammam', false)],
      ...over,
    },
  });
}

let productSeq = 0;
async function mkProduct(over: Record<string, unknown> = {}) {
  productSeq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Sofa ${productSeq}`, ar: `كنبة ${productSeq}` },
      description: { en: 'd', ar: 'د' },
      slug: `sofa-${productSeq}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10_000,
      stock: 10,
      categoryId,
      status: 'PUBLISHED',
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
      ...over,
    },
  });
}

const mkAddress = (uid: string, cityCode: string) =>
  prisma.address.create({
    data: {
      userId: uid,
      label: 'Home',
      fullName: 'Sara Ali',
      phone: '+966551234567',
      cityCode,
      area: 'Olaya',
      street: 'King Fahd Rd 12',
      notes: null,
      isDefault: true,
    },
  });

const setCart = (uid: string, lines: { productId: string; qty: number; priceSeen: number }[]) =>
  prisma.cart.upsert({
    where: { userId: uid },
    create: { userId: uid, items: lines, version: 0 },
    update: { items: lines, version: { increment: 1 } },
  });

/** Direct PENDING order fixture (bypasses the API and its limits). */
const mkOrder = (uid: string, over: Record<string, unknown> = {}) =>
  prisma.order.create({
    data: {
      orderNo: `FX-20260101-${String(++productSeq).padStart(4, '0')}`,
      userId: uid,
      idempotencyKey: crypto.randomUUID(),
      addressId: '0'.repeat(24),
      items: [],
      address: {
        fullName: 'Sara Ali',
        phone: '+966551234567',
        cityCode: 'riyadh',
        city: { en: 'riyadh-en', ar: 'riyadh-ar' },
        area: 'Olaya',
        street: 'King Fahd Rd 12',
        notes: null,
      },
      subtotal: 0,
      deliveryFee: 0,
      vat: {
        vatRate: 0,
        vatAmount: 0,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
      total: 0,
      statusHistory: [],
      customerNote: null,
      adminNote: null,
      ...over,
    },
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});

beforeEach(async () => {
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.address.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.counter.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await seedSettings();
  const mk = (email: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
    prisma.user.create({
      data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true, role },
    });
  const [u, o, a] = await Promise.all([
    mk('me@example.com'),
    mk('other@example.com'),
    mk('admin@example.com', 'ADMIN'),
  ]);
  [userId, otherId] = [u.id, o.id];
  [token, otherToken, adminToken] = [signAccessToken(u), signAccessToken(o), signAccessToken(a)];
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Sofas', ar: 'كنب' }, slug: 'sofas', image: null, parentId: null },
    })
  ).id;
  addressId = (await mkAddress(userId, 'riyadh')).id;
});

afterEach(() => {
  delete testHooks.beforeTransaction;
});

afterAll(async () => {
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.address.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.counter.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSetting.deleteMany();
  await prisma.$disconnect();
});

describe('ORD-01 · happy path', () => {
  it('ORD-01 · places a COD order: PENDING, full snapshot, stock decremented, cart cleared', async () => {
    await seedSettings({
      deliveryFee: 1_000,
      vat: {
        vatRate: 15,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: '311111111111113',
      },
    });
    const p = await mkProduct({ price: 12_500, sku: 'SOFA-1' });
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);

    const res = await place({
      addressId,
      expectedTotal: 13_500,
      customerNote: '  ring the bell  ',
    });
    expect(res.status).toBe(201);
    const body = res.body as {
      orderNo: string;
      vat: unknown;
      items: unknown;
      address: unknown;
      user: unknown;
      statusHistory: { status: string }[];
    } & Record<string, unknown>;
    expect(body.orderNo).toMatch(new RegExp(`^FX-${riyadhYmd()}-\\d{4}$`));
    expect(body).toMatchObject({
      status: 'PENDING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      currency: 'SAR',
      subtotal: 12_500,
      deliveryFee: 1_000,
      total: 13_500,
      customerNote: 'ring the bell',
    });
    expect(body).not.toHaveProperty('adminNote'); // internal, admin responses only (T-014)
    expect(body.vat).toEqual({
      vatRate: 15,
      vatAmount: 1_761, // round(13500 × 1500 / 11500), T-021 half-up
      applyToDelivery: true,
      pricesIncludeVat: true,
      registrationNumber: '311111111111113',
    });
    expect(body.items).toEqual([
      {
        productId: p.id,
        titleSnapshot: { en: p.title.en, ar: p.title.ar },
        sku: 'SOFA-1',
        imageSnapshot: null,
        unitPrice: 12_500,
        qty: 1,
        lineTotal: 12_500,
        type: 'NEW',
        condition: 'NEW',
      },
    ]);
    expect(body.address).toEqual({
      fullName: 'Sara Ali',
      phone: '+966551234567',
      cityCode: 'riyadh',
      city: { en: 'riyadh-en', ar: 'riyadh-ar' },
      area: 'Olaya',
      street: 'King Fahd Rd 12',
      notes: null,
    });
    expect(body.user).toEqual({
      id: userId,
      firstName: 'T',
      lastName: 'U',
      email: 'me@example.com',
    });
    expect(body.statusHistory).toHaveLength(1);
    // Customer shape: {status, at} only; byUserId stays server-side (T-014) but is persisted.
    expect(body.statusHistory[0]).toMatchObject({ status: 'PENDING' });
    expect(body.statusHistory[0]).not.toHaveProperty('byUserId');
    const stored = await prisma.order.findFirstOrThrow({ where: { userId } });
    expect(stored.statusHistory[0]).toMatchObject({ status: 'PENDING', byUserId: userId });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(9);
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId } })).items).toHaveLength(0);
  });

  it('ORD-01 · a second order the same day increments the daily sequence', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const first = (await place({ addressId, expectedTotal: 10_000 }).expect(201)).body
      .orderNo as string;
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const second = (await place({ addressId, expectedTotal: 10_000 }).expect(201)).body
      .orderNo as string;
    const seq = (no: string) => Number(no.slice(-4));
    expect(no0(first)).toBe(no0(second));
    expect(seq(second)).toBe(seq(first) + 1);
    function no0(no: string) {
      return no.slice(0, no.length - 4);
    }
  });

  it('ORD-01 · snapshot stored even when fee and VAT are 0; later product/settings changes never alter it', async () => {
    const image = {
      key: 'furnixa/test/2026/11/3f2b8c1e-0c4d-4a52-9d7e-1b2a3c4d5e6f.webp',
      url: 'https://cdn.example.com/furnixa/test/2026/11/3f2b8c1e-0c4d-4a52-9d7e-1b2a3c4d5e6f.webp',
      alt: null,
      width: null,
      height: null,
    };
    const p = await mkProduct({ price: 10_000, images: [image] });
    await setCart(userId, [{ productId: p.id, qty: 2, priceSeen: p.price }]);
    const created = (await place({ addressId, expectedTotal: 20_000 }).expect(201)).body;
    expect(created.deliveryFee).toBe(0);
    expect(created.vat).toMatchObject({ vatRate: 0, vatAmount: 0 });
    expect(created.total).toBe(20_000);
    expect(created.items[0].imageSnapshot).toBe(image.url);

    // Change everything afterwards.
    await seedSettings({
      deliveryFee: 9_999,
      vat: { vatRate: 15, applyToDelivery: false, pricesIncludeVat: false },
    });
    await prisma.product.update({
      where: { id: p.id },
      data: { title: { en: 'Renamed', ar: 'جديد' }, price: 99_999, images: [], status: 'ARCHIVED' },
    });

    const row = await prisma.order.findUniqueOrThrow({ where: { id: created.id as string } });
    expect(row.total).toBe(20_000);
    expect(row.deliveryFee).toBe(0);
    expect(row.vat.vatAmount).toBe(0);
    expect(row.items[0]!.titleSnapshot).toEqual({ en: p.title.en, ar: p.title.ar });
    expect(row.items[0]!.unitPrice).toBe(10_000);
    expect(row.items[0]!.lineTotal).toBe(20_000);
    expect(row.items[0]!.imageSnapshot).toBe(image.url);
    expect(row.items[0]!.imageKey).toBe(image.key);
  });

  it('ORD-01 · imageKey is stored as an explicit null for an imageless product and never exposed in the response', async () => {
    const p = await mkProduct(); // images: []
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const body = (await place({ addressId, expectedTotal: 10_000 }).expect(201)).body;
    expect(body.items[0].imageKey).toBeUndefined(); // server-side only
    const row = await prisma.order.findUniqueOrThrow({ where: { id: body.id as string } });
    expect(row.items[0]!.imageKey).toBeNull();
    expect(row.items[0]!.imageSnapshot).toBeNull();
  });

  it('ORD-01 · order.created is emitted after commit with the order, and not on a failed placement', async () => {
    const seen: string[] = [];
    const off = onOrderEvent('order.created', ({ order }) => {
      seen.push(order.orderNo);
    });
    try {
      const p = await mkProduct();
      await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
      const orderNo = (await place({ addressId, expectedTotal: 10_000 }).expect(201)).body
        .orderNo as string;
      expect(seen).toEqual([orderNo]);
      // A rejected placement (wrong total) must not emit.
      await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
      await place({ addressId, expectedTotal: 1 }).expect(409);
      expect(seen).toEqual([orderNo]);
    } finally {
      off();
    }
  });
});

describe('ORD-01 · rejections (nothing written)', () => {
  it('ORD-01 · out-of-stock and unavailable lines → 409 with per-item details, nothing decremented, cart kept', async () => {
    const low = await mkProduct({ stock: 1 });
    const gone = await mkProduct({ status: 'ARCHIVED' });
    const ok = await mkProduct();
    await setCart(userId, [
      { productId: low.id, qty: 2, priceSeen: low.price },
      { productId: gone.id, qty: 1, priceSeen: gone.price },
      { productId: ok.id, qty: 1, priceSeen: ok.price },
    ]);
    const res = await place({ addressId, expectedTotal: 40_000 }).expect(409);
    expect(res.body.code).toBe('OUT_OF_STOCK');
    expect(res.body.details.items).toEqual([
      { productId: low.id, stock: 1 },
      { productId: gone.id, stock: 0 },
    ]);
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: ok.id } })).stock).toBe(10);
    expect((await prisma.cart.findUniqueOrThrow({ where: { userId } })).items).toHaveLength(3);
  });

  it('ORD-01 · address in an unknown or inactive city → 422 OUT_OF_DELIVERY_AREA, nothing decremented', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    for (const code of ['dammam', 'atlantis']) {
      const addr = await mkAddress(userId, code);
      const res = await place({ addressId: addr.id, expectedTotal: 10_000 }).expect(422);
      expect(res.body.code).toBe('OUT_OF_DELIVERY_AREA');
    }
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
  });

  it('ORD-01 · expectedTotal mismatch → 409 PRICE_CHANGED with price-diff items, nothing decremented', async () => {
    const p = await mkProduct({ price: 1_000 });
    await setCart(userId, [{ productId: p.id, qty: 2, priceSeen: 1_000 }]);
    await prisma.product.update({ where: { id: p.id }, data: { price: 1_200 } });
    const res = await place({ addressId, expectedTotal: 2_000 }).expect(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details).toEqual({
      expectedTotal: 2_000,
      total: 2_400,
      items: [{ productId: p.id, oldPrice: 1_000, newPrice: 1_200 }],
    });
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
  });

  it('ORD-01 · a price change between read and transaction yields 409 PRICE_CHANGED, not an order at the old price', async () => {
    const p = await mkProduct({ price: 10_000 });
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: 10_000 }]);
    testHooks.beforeTransaction = async (attempt) => {
      if (attempt === 0) {
        await prisma.product.update({ where: { id: p.id }, data: { price: 9_000 } });
      }
    };
    const res = await place({ addressId, expectedTotal: 10_000 }).expect(409);
    expect(res.body.code).toBe('PRICE_CHANGED');
    expect(res.body.details).toMatchObject({ expectedTotal: 10_000, total: 9_000 });
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);
  });

  it('ORD-01 · empty or missing cart → 409 CART_EMPTY', async () => {
    expect((await place({ addressId, expectedTotal: 0 }).expect(409)).body.code).toBe('CART_EMPTY');
    await prisma.cart.create({ data: { userId, items: [], version: 0 } });
    expect((await place({ addressId, expectedTotal: 0 }).expect(409)).body.code).toBe('CART_EMPTY');
  });

  it('ORD-01 · foreign, unknown or malformed addressId → 404', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const foreign = await mkAddress(otherId, 'riyadh');
    for (const id of [foreign.id, '0'.repeat(24), 'not-an-id']) {
      expect((await place({ addressId: id, expectedTotal: 10_000 })).status).toBe(404);
    }
  });

  it('ORD-01 · missing/malformed Idempotency-Key or expectedTotal → 422; admin → 403; no token → 401', async () => {
    const body = { addressId, expectedTotal: 10_000 };
    expect((await place(body, { key: null })).status).toBe(422);
    expect((await place(body, { key: 'not-a-uuid' })).status).toBe(422);
    expect((await place({ addressId })).status).toBe(422); // expectedTotal is required
    expect((await place(body, { t: adminToken })).status).toBe(403);
    expect((await request(app).post(BASE).send(body)).status).toBe(401);
    expect(await prisma.order.count()).toBe(0);
  });
});

describe('ORD-01 · idempotency', () => {
  it('ORD-01 · a retry after success returns the same order', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const key = crypto.randomUUID();
    const first = await place({ addressId, expectedTotal: 10_000 }, { key }).expect(201);
    // The cart is already cleared; the replay must not re-validate or decrement.
    const retry = await place({ addressId, expectedTotal: 10_000 }, { key }).expect(200);
    expect(retry.body).toEqual(first.body);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(9);
  });

  it('ORD-01 · the same key with a different addressId or expectedTotal → 422 IDEMPOTENCY_MISMATCH', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const key = crypto.randomUUID();
    await place({ addressId, expectedTotal: 10_000 }, { key }).expect(201);
    const addr2 = await mkAddress(userId, 'jeddah');
    const r1 = await place({ addressId: addr2.id, expectedTotal: 10_000 }, { key }).expect(422);
    expect(r1.body.code).toBe('IDEMPOTENCY_MISMATCH');
    const r2 = await place({ addressId, expectedTotal: 12_500 }, { key }).expect(422);
    expect(r2.body.code).toBe('IDEMPOTENCY_MISMATCH');
    expect(await prisma.order.count()).toBe(1);
  });

  it('ORD-01 · two concurrent POSTs with the same key create exactly one order and decrement stock once', async () => {
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const key = crypto.randomUUID();
    const body = { addressId, expectedTotal: 10_000 };
    const [r1, r2] = await Promise.all([place(body, { key }), place(body, { key })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    expect(r1.body.orderNo).toBe(r2.body.orderNo);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(9);
  });
});

describe('ORD-01 · stock consistency', () => {
  it('ORD-01 · two concurrent buyers, stock 1 → exactly one succeeds and stock ends at 0', async () => {
    const p = await mkProduct({ stock: 1 });
    const otherAddress = await mkAddress(otherId, 'riyadh');
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    await setCart(otherId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    // Deterministic stale-read interleaving (T-012 barrier pattern): the held buyer validates
    // against stock 1, then waits until the first buyer has committed before its transaction runs.
    // A naive Promise.all race is masked by MongoDB write conflicts (the loser retries from a
    // fresh read and is rejected by validation), so only this ordering proves that the
    // `stock: { gte: qty }` condition in the decrement's where-clause prevents the oversell.
    let releaseHeld!: () => void;
    const firstCommitted = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    let heldAtGate!: () => void;
    const heldReady = new Promise<void>((resolve) => {
      heldAtGate = resolve;
    });
    let hookCalls = 0;
    testHooks.beforeTransaction = async (attempt) => {
      if (attempt > 0) return;
      hookCalls += 1;
      if (hookCalls === 1) {
        heldAtGate();
        await firstCommitted;
      }
    };
    const held = place(
      { addressId: otherAddress.id, expectedTotal: 10_000 },
      { t: otherToken },
    ).then((r) => r);
    await heldReady; // the held buyer has validated against stock 1 and sits before its transaction
    const first = await place({ addressId, expectedTotal: 10_000 });
    expect(first.status).toBe(201);
    releaseHeld();
    const loser = await held;
    expect(loser.status).toBe(409);
    expect(loser.body.code).toBe('OUT_OF_STOCK');
    expect(loser.body.details.items).toEqual([{ productId: p.id, stock: 0 }]);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
  });

  it('ORD-01 · a concurrent cart PUT during checkout is not lost by the clear', async () => {
    const a = await mkProduct();
    const b = await mkProduct();
    await setCart(userId, [{ productId: a.id, qty: 1, priceSeen: a.price }]);
    testHooks.beforeTransaction = async (attempt) => {
      if (attempt > 0) return;
      // Simulates a PUT /cart/items landing between the placement's read and its transaction.
      const cart = await prisma.cart.findUniqueOrThrow({ where: { userId } });
      await prisma.cart.update({
        where: { userId },
        data: {
          items: [...cart.items, { productId: b.id, qty: 2, priceSeen: b.price }],
          version: cart.version + 1,
        },
      });
    };
    await place({ addressId, expectedTotal: 10_000 }).expect(201);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId } });
    expect(cart.items).toEqual([{ productId: b.id, qty: 2, priceSeen: b.price }]);
  });

  it('ORD-01 · 20 concurrent placements on the same day get 20 distinct orderNo values', async () => {
    const buyers = await Promise.all(
      Array.from({ length: 20 }, async (_, i) => {
        const user = await prisma.user.create({
          data: {
            firstName: 'B',
            lastName: `${i}`,
            email: `buyer${i}@example.com`,
            passwordHash: hash,
            isVerified: true,
            role: 'CUSTOMER',
          },
        });
        const [addr, product] = await Promise.all([mkAddress(user.id, 'riyadh'), mkProduct()]);
        await setCart(user.id, [{ productId: product.id, qty: 1, priceSeen: product.price }]);
        return { token: signAccessToken(user), addressId: addr.id };
      }),
    );
    const results = await Promise.all(
      buyers.map((b) => place({ addressId: b.addressId, expectedTotal: 10_000 }, { t: b.token })),
    );
    for (const r of results) expect(r.status).toBe(201);
    const orderNos = results.map((r) => r.body.orderNo as string);
    expect(new Set(orderNos).size).toBe(20);
    for (const no of orderNos) expect(no).toMatch(/^FX-\d{8}-\d{4}$/);
  }, 20_000);
});

describe('ORD-01 · COD abuse limits', () => {
  it('ORD-01 · the 4th order within an hour → 429 RATE_LIMITED with Retry-After', async () => {
    const p = await mkProduct({ stock: 100 });
    for (let i = 0; i < 3; i++) {
      await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
      await place({ addressId, expectedTotal: 10_000 }).expect(201);
    }
    // Clear PENDING so only the hourly limit can fire.
    await prisma.order.updateMany({ where: { userId }, data: { status: 'CONFIRMED' } });
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const res = await place({ addressId, expectedTotal: 10_000 }).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await prisma.order.count()).toBe(3);
  });

  it('ORD-01 · a 4th PENDING order → 409 TOO_MANY_PENDING_ORDERS', async () => {
    await Promise.all([mkOrder(userId), mkOrder(userId), mkOrder(userId)]);
    const p = await mkProduct();
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    const res = await place({ addressId, expectedTotal: 10_000 }).expect(409);
    expect(res.body.code).toBe('TOO_MANY_PENDING_ORDERS');
    expect(await prisma.order.count()).toBe(3);
    // A non-PENDING history does not count towards the cap.
    await prisma.order.updateMany({ where: { userId }, data: { status: 'DELIVERED' } });
    await place({ addressId, expectedTotal: 10_000 }).expect(201);
  });

  it('ORD-01 · confirming or cancelling an order frees a TOO_MANY_PENDING_ORDERS slot (owner 2026-11-22, T-014)', async () => {
    const [o1, o2] = await Promise.all([mkOrder(userId), mkOrder(userId), mkOrder(userId)]);
    const p = await mkProduct();

    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    expect((await place({ addressId, expectedTotal: 10_000 })).status).toBe(409);

    // The admin confirms one PENDING order -> one slot frees up.
    await request(app)
      .patch(`/api/v1/admin/orders/${o1!.id}/status`)
      .set(auth(adminToken))
      .send({ status: 'CONFIRMED' })
      .expect(200);
    await place({ addressId, expectedTotal: 10_000 }).expect(201);

    // Back at the cap; a cancel frees a slot just the same.
    await setCart(userId, [{ productId: p.id, qty: 1, priceSeen: p.price }]);
    expect((await place({ addressId, expectedTotal: 10_000 })).status).toBe(409);
    await request(app)
      .patch(`/api/v1/admin/orders/${o2!.id}/status`)
      .set(auth(adminToken))
      .send({ status: 'CANCELLED', note: 'customer asked to cancel' })
      .expect(200);
    await place({ addressId, expectedTotal: 10_000 }).expect(201);
  });
});
