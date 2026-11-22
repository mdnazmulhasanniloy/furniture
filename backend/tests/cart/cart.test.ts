import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cart_t012',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { testHooks } from '../../src/modules/cart/service.js';

const app = createApp();
const BASE = '/api/v1/cart';

type CartBody = {
  items: {
    product: { id: string; price: number } | null;
    qty: number;
    lineTotal: number;
    issue: string | null;
    details: { oldPrice: number; newPrice: number } | null;
  }[];
  subtotal: number;
  deliveryFee: number;
  vat: { vatRate: number; vatAmount: number };
  total: number;
  address: { id: string; cityCode: string; isDeliverable: boolean } | null;
};

let hash = '';
let token = '';
let userId = '';
let otherToken = '';
let adminToken = '';
let categoryId = '';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const put = (productId: string, qty: number, t = token) =>
  request(app).put(`${BASE}/items`).set(auth(t)).send({ productId, qty });
const mergeReq = (items: { productId: string; qty: number }[], t = token) =>
  request(app).post(`${BASE}/merge`).set(auth(t)).send({ items });
const get = async (q = '', t = token) =>
  (await request(app).get(`${BASE}${q}`).set(auth(t)).expect(200)).body as CartBody;

const city = (code: string, isActive: boolean, deliveryFee: number | null = null) => ({
  code,
  name: { en: code, ar: code },
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

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});
beforeEach(async () => {
  await prisma.cart.deleteMany();
  await prisma.address.deleteMany();
  await prisma.product.deleteMany();
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
  userId = u.id;
  [token, otherToken, adminToken] = [signAccessToken(u), signAccessToken(o), signAccessToken(a)];
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Sofas', ar: 'كنب' }, slug: 'sofas', image: null, parentId: null },
    })
  ).id;
});
afterAll(async () => {
  await Promise.all([
    prisma.cart.deleteMany(),
    prisma.address.deleteMany(),
    prisma.product.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.siteSetting.deleteMany();
  await prisma.$disconnect();
});

describe('CART-01 · items', () => {
  it('CART-01 · PUT adds a line with lineTotal and qty 0 removes it', async () => {
    const p = await mkProduct({ price: 2_000 });
    const added = (await put(p.id, 3).expect(200)).body as CartBody;
    expect(added.items).toHaveLength(1);
    expect(added.items[0]).toMatchObject({ qty: 3, lineTotal: 6_000, issue: null });
    expect(added.subtotal).toBe(6_000);
    expect((await put(p.id, 0).expect(200)).body.items).toHaveLength(0);
  });

  it('CART-01 · qty above stock -> 409 OUT_OF_STOCK and nothing is written', async () => {
    const p = await mkProduct({ stock: 2 });
    const res = await put(p.id, 3).expect(409);
    expect(res.body.code).toBe('OUT_OF_STOCK');
    expect(res.body.details).toMatchObject({ productId: p.id, stock: 2 });
    expect((await get()).items).toHaveLength(0);
  });

  it('CART-01 · unknown or non-PUBLISHED product -> 404', async () => {
    const draft = await mkProduct({ status: 'DRAFT' });
    expect((await put('0'.repeat(24), 1)).status).toBe(404);
    expect((await put(draft.id, 1)).status).toBe(404);
  });

  it('CART-01 · the 51st distinct line -> 409 CART_LIMIT_REACHED', async () => {
    const products = await Promise.all(Array.from({ length: 51 }, () => mkProduct()));
    await prisma.cart.create({
      data: {
        userId,
        items: products.slice(0, 50).map((p) => ({ productId: p.id, qty: 1, priceSeen: p.price })),
        version: 0,
      },
    });
    const res = await put(products[50]!.id, 1).expect(409);
    expect(res.body.code).toBe('CART_LIMIT_REACHED');
    // Replacing an existing line still works at the limit.
    await put(products[0]!.id, 2).expect(200);
  });

  it('CART-01 · two concurrent PUTs for different products both survive', async () => {
    const [a, b, seed] = await Promise.all([mkProduct(), mkProduct(), mkProduct()]);
    // The cart must already exist so both PUTs take the conditional-update path (the create path
    // is serialized by the unique userId index and would pass even without the version guard).
    await prisma.cart.create({
      data: {
        userId,
        items: [{ productId: seed!.id, qty: 1, priceSeen: seed!.price }],
        version: 0,
      },
    });
    // Deterministic lost-update interleaving via the service's test hook: both writers hold
    // between read and write until both have read, so both saw version 0.
    let release!: () => void;
    const bothHaveRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    let readers = 0;
    testHooks.beforeWrite = async (attempt) => {
      if (attempt > 0) return; // retries pass straight through
      readers += 1;
      if (readers === 2) release();
      await bothHaveRead;
    };
    try {
      const [r1, r2] = await Promise.all([put(a!.id, 1), put(b!.id, 2)]);
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
    } finally {
      delete testHooks.beforeWrite;
    }
    const cart = await get();
    expect(cart.items.map((i) => i.product?.id).sort()).toEqual([seed!.id, a!.id, b!.id].sort());
  });
});

describe('CART-01 · merge', () => {
  it('CART-01 · merge keeps the larger of server and guest qty, capped at stock', async () => {
    const low = await mkProduct({ stock: 4 });
    const high = await mkProduct();
    await put(low.id, 3).expect(200);
    await put(high.id, 5).expect(200);
    const body = (
      await mergeReq([
        { productId: low.id, qty: 9 }, // capped at 4
        { productId: high.id, qty: 2 }, // existing 5 wins
      ]).expect(200)
    ).body as CartBody;
    const byId = new Map(body.items.map((i) => [i.product?.id, i.qty]));
    expect(byId.get(low.id)).toBe(4);
    expect(byId.get(high.id)).toBe(5);
  });

  it('CART-01 · repeating the same merge does not double quantities', async () => {
    const p = await mkProduct();
    await put(p.id, 2).expect(200);
    const payload = [{ productId: p.id, qty: 6 }];
    await mergeReq(payload).expect(200);
    const twice = (await mergeReq(payload).expect(200)).body as CartBody;
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]!.qty).toBe(6);
  });

  it('CART-01 · merge skips unknown and unpublished products and combines duplicate ids with max', async () => {
    const p = await mkProduct();
    const draft = await mkProduct({ status: 'DRAFT' });
    const body = (
      await mergeReq([
        { productId: p.id, qty: 2 },
        { productId: p.id, qty: 4 }, // duplicate: max wins
        { productId: draft.id, qty: 1 },
        { productId: '0'.repeat(24), qty: 1 },
      ]).expect(200)
    ).body as CartBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ qty: 4 });
    expect((await mergeReq([]).expect(200)).body.items).toHaveLength(1); // empty merge is a no-op
  });
});

describe('CART-01 · pricing (delivery fee, VAT)', () => {
  it('CART-01 · all defaults -> fee 0, vatAmount 0, total = subtotal', async () => {
    const p = await mkProduct({ price: 2_500 });
    await put(p.id, 2).expect(200);
    const cart = await get();
    expect(cart).toMatchObject({ subtotal: 5_000, deliveryFee: 0, total: 5_000 });
    expect(cart.vat.vatAmount).toBe(0);
  });

  it('CART-01 · empty cart prices as 0 even when a base fee is set', async () => {
    await seedSettings({ deliveryFee: 1_500 });
    expect(await get()).toMatchObject({ items: [], subtotal: 0, deliveryFee: 0, total: 0 });
  });

  it('CART-01 · addressId uses the city override and sets isDeliverable', async () => {
    await seedSettings({ deliveryFee: 1_000 });
    const p = await mkProduct();
    await put(p.id, 1).expect(200);
    const addr = await mkAddress(userId, 'jeddah'); // override 2500
    const cart = await get(`?addressId=${addr.id}`);
    expect(cart.deliveryFee).toBe(2_500);
    expect(cart.address).toEqual({ id: addr.id, cityCode: 'jeddah', isDeliverable: true });
  });

  it('CART-01 · no address yet, and a city without override, both fall back to the base fee', async () => {
    await seedSettings({ deliveryFee: 1_000 });
    const p = await mkProduct();
    await put(p.id, 1).expect(200);
    expect((await get()).deliveryFee).toBe(1_000); // no addressId -> base fee (PRD CART-01)
    const addr = await mkAddress(userId, 'riyadh'); // no override
    expect((await get(`?addressId=${addr.id}`)).deliveryFee).toBe(1_000);
  });

  it('CART-01 · inactive city prices with the base fee but isDeliverable is false', async () => {
    await seedSettings({ deliveryFee: 1_000 });
    const p = await mkProduct();
    await put(p.id, 1).expect(200);
    const addr = await mkAddress(userId, 'dammam'); // inactive
    const cart = await get(`?addressId=${addr.id}`);
    expect(cart.deliveryFee).toBe(1_000);
    expect(cart.address).toMatchObject({ isDeliverable: false });
  });

  it('CART-01 · free-delivery threshold met by the line subtotal -> fee 0', async () => {
    await seedSettings({ deliveryFee: 1_000, freeDeliveryThreshold: 20_000 });
    const p = await mkProduct({ price: 10_000 });
    await put(p.id, 2).expect(200); // subtotal 20000 from lines, not a precomputed value
    expect((await get()).deliveryFee).toBe(0);
  });

  it('CART-01 · vatRate > 0 (inclusive) returns the VAT share, total unchanged', async () => {
    await seedSettings({ vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true } });
    const p = await mkProduct({ price: 12_500 });
    await put(p.id, 1).expect(200);
    const cart = await get();
    expect(cart.vat.vatAmount).toBe(1_630); // T-021 reference value
    expect(cart.total).toBe(12_500);
  });
});

describe('CART-01 · issues (read-only GET)', () => {
  it('CART-01 · a sold-out line is flagged OUT_OF_STOCK, excluded from pricing, and does not throw', async () => {
    const sold = await mkProduct({ price: 3_000 });
    const ok = await mkProduct({ price: 1_000 });
    await put(sold.id, 1).expect(200);
    await put(ok.id, 2).expect(200);
    await prisma.product.update({ where: { id: sold.id }, data: { stock: 0 } });
    const cart = await get();
    const soldLine = cart.items.find((i) => i.product?.id === sold.id)!;
    expect(soldLine).toMatchObject({ qty: 0, lineTotal: 0, issue: 'OUT_OF_STOCK' });
    expect(cart.subtotal).toBe(2_000);
    expect(cart.total).toBe(2_000);
  });

  it('CART-01 · qty above the new stock is flagged QTY_REDUCED with capped qty and totals', async () => {
    const p = await mkProduct({ price: 1_000 });
    await put(p.id, 5).expect(200);
    await prisma.product.update({ where: { id: p.id }, data: { stock: 2 } });
    const cart = await get();
    expect(cart.items[0]).toMatchObject({ qty: 2, lineTotal: 2_000, issue: 'QTY_REDUCED' });
    expect(cart.subtotal).toBe(2_000);
    // GET is read-only: the stored qty is unchanged.
    const stored = await prisma.cart.findUnique({ where: { userId } });
    expect(stored!.items[0]!.qty).toBe(5);
  });

  it('CART-01 · an unpublished product is flagged UNAVAILABLE with product null and excluded', async () => {
    const p = await mkProduct();
    await put(p.id, 1).expect(200);
    await prisma.product.update({ where: { id: p.id }, data: { status: 'ARCHIVED' } });
    const cart = await get();
    expect(cart.items[0]).toMatchObject({
      product: null,
      qty: 0,
      lineTotal: 0,
      issue: 'UNAVAILABLE',
    });
    expect(cart.subtotal).toBe(0);
  });

  it('CART-01 · a price change is flagged PRICE_CHANGED and the next PUT refreshes priceSeen', async () => {
    const p = await mkProduct({ price: 1_000 });
    await put(p.id, 2).expect(200);
    await prisma.product.update({ where: { id: p.id }, data: { price: 1_200 } });
    const cart = await get();
    expect(cart.items[0]!.issue).toBe('PRICE_CHANGED');
    expect(cart.items[0]!.details).toEqual({ oldPrice: 1_000, newPrice: 1_200 });
    expect(cart.items[0]!.lineTotal).toBe(2_400); // live price
    await put(p.id, 2).expect(200); // refreshes priceSeen
    expect((await get()).items[0]!.issue).toBeNull();
  });

  it('CART-01 · issue priority: QTY_REDUCED beats PRICE_CHANGED', async () => {
    const p = await mkProduct({ price: 1_000 });
    await put(p.id, 5).expect(200);
    await prisma.product.update({ where: { id: p.id }, data: { price: 900, stock: 3 } });
    expect((await get()).items[0]!.issue).toBe('QTY_REDUCED');
  });
});

describe('CART-01 · access', () => {
  it('CART-01 · carts are per user and a foreign or malformed addressId -> 404', async () => {
    const p = await mkProduct();
    await put(p.id, 1).expect(200);
    expect((await get('', otherToken)).items).toHaveLength(0);
    const foreign = await mkAddress(
      (await prisma.user.findFirst({ where: { email: 'other@example.com' } }))!.id,
      'riyadh',
    );
    await request(app).get(`${BASE}?addressId=${foreign.id}`).set(auth(token)).expect(404);
    await request(app).get(`${BASE}?addressId=not-an-id`).set(auth(token)).expect(404);
  });

  it('CART-01 · requires a customer: no token -> 401, admin -> 403', async () => {
    await request(app).get(BASE).expect(401);
    const res = await request(app).get(BASE).set(auth(adminToken)).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await request(app)
      .put(`${BASE}/items`)
      .set(auth(adminToken))
      .send({ productId: '0'.repeat(24), qty: 1 })
      .expect(403);
    await request(app).post(`${BASE}/merge`).set(auth(adminToken)).send({ items: [] }).expect(403);
  });
});
