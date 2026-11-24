import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_wishlist_t031',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { testHooks } from '../../src/modules/wishlist/service.js';

const app = createApp();
const BASE = '/api/v1/me/wishlist';

type WishBody = { productIds: string[]; items: { id: string }[]; total: number };

let hash = '';
let token = '';
let userId = '';
let otherToken = '';
let adminToken = '';
let categoryId = '';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const put = (id: string, t = token) => request(app).put(`${BASE}/${id}`).set(auth(t));
const del = (id: string, t = token) => request(app).delete(`${BASE}/${id}`).set(auth(t));
const get = (t = token) => request(app).get(BASE).set(auth(t));
const mergeReq = (productIds: string[], t = token) =>
  request(app).post(`${BASE}/merge`).set(auth(t)).send({ productIds });

let seq = 0;
async function mkProduct(over: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Sofa ${seq}`, ar: `كنبة ${seq}` },
      description: { en: 'd', ar: 'د' },
      slug: `sofa-${seq}`,
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

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});
beforeEach(async () => {
  await prisma.wishlist.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
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
  await prisma.wishlist.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('FAV-01 · access', () => {
  it('FAV-01 · requires a token and refuses admins', async () => {
    const p = await mkProduct();
    await request(app).get(BASE).expect(401);
    for (const t of [adminToken]) {
      await get(t).expect(403);
      await put(p.id, t).expect(403);
      await del(p.id, t).expect(403);
      await request(app).delete(BASE).set(auth(t)).expect(403);
      await mergeReq([p.id], t).expect(403);
    }
  });
});

describe('FAV-01 · add / remove / list', () => {
  it('FAV-01 · starts empty; add is idempotent; list is newest first', async () => {
    const [a, b] = [await mkProduct(), await mkProduct()];
    expect((await get().expect(200)).body).toMatchObject({ productIds: [], items: [], total: 0 });
    await put(a.id).expect(200);
    await put(a.id).expect(200);
    const res = await put(b.id).expect(200);
    const body = res.body as WishBody;
    expect(body.productIds).toEqual([b.id, a.id]);
    expect(body.items.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(body.total).toBe(2);
    expect(
      (await prisma.wishlist.findUniqueOrThrow({ where: { userId } })).productIds,
    ).toHaveLength(2);
  });

  it('FAV-01 · remove is idempotent, also for unsaved and malformed ids; clear empties the list', async () => {
    const [a, b] = [await mkProduct(), await mkProduct()];
    await put(a.id);
    await put(b.id);
    expect(((await del(a.id).expect(200)).body as WishBody).productIds).toEqual([b.id]);
    await del(a.id).expect(200);
    await del('not-an-id').expect(200);
    await request(app).delete(BASE).set(auth(token)).expect(204);
    await request(app).delete(BASE).set(auth(token)).expect(204);
    expect(((await get().expect(200)).body as WishBody).total).toBe(0);
  });

  it('FAV-01 · unknown, malformed or unpublished products cannot be added (404 NOT_FOUND)', async () => {
    const draft = await mkProduct({ status: 'DRAFT' });
    for (const id of ['000000000000000000000000', 'nope', draft.id]) {
      const res = await put(id).expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  it('FAV-01 · lists are per user', async () => {
    const a = await mkProduct();
    await put(a.id);
    expect(((await get(otherToken).expect(200)).body as WishBody).total).toBe(0);
  });

  it('FAV-01 · an unpublished or deleted product is neither shown nor counted, and is pruned on the next write', async () => {
    const [a, b, c] = [await mkProduct(), await mkProduct(), await mkProduct()];
    await put(a.id);
    await put(b.id);
    await prisma.product.update({ where: { id: a.id }, data: { status: 'DRAFT' } });
    await prisma.product.delete({ where: { id: b.id } });
    const res = (await get().expect(200)).body as WishBody;
    expect(res).toMatchObject({ productIds: [], total: 0 });
    // GET never rewrites.
    expect(
      (await prisma.wishlist.findUniqueOrThrow({ where: { userId } })).productIds,
    ).toHaveLength(2);
    await put(c.id).expect(200);
    expect((await prisma.wishlist.findUniqueOrThrow({ where: { userId } })).productIds).toEqual([
      c.id,
    ]);
  });

  it('FAV-01 · the 101st distinct product is refused with 409 WISHLIST_LIMIT_REACHED; re-adding a saved one still works', async () => {
    const products = [];
    for (let i = 0; i < 101; i++) products.push(await mkProduct());
    const ids = products.slice(0, 100).map((p) => p.id);
    await prisma.wishlist.create({ data: { userId, productIds: ids, version: 0 } });
    const res = await put(products[100]!.id).expect(409);
    expect(res.body.code).toBe('WISHLIST_LIMIT_REACHED');
    await put(ids[0]!).expect(200);
    await del(ids[0]!).expect(200);
    await put(products[100]!.id).expect(200);
  });
});

describe('FAV-01 · merge', () => {
  it('FAV-01 · union keeps existing first then guest order; skips unknown, unpublished, malformed and duplicates', async () => {
    const [a, b, c, d] = [
      await mkProduct(),
      await mkProduct(),
      await mkProduct(),
      await mkProduct({ status: 'DRAFT' }),
    ];
    await put(a.id);
    const res = await mergeReq([
      c.id,
      b.id,
      a.id,
      c.id,
      d.id,
      'zzz',
      '000000000000000000000000',
    ]).expect(200);
    // given 7: valid published unique = c, b, a -> skipped 4
    expect(res.body).toEqual({
      productIds: [b.id, c.id, a.id],
      total: 3,
      skipped: 4,
      truncated: 0,
    });
    expect((await prisma.wishlist.findUniqueOrThrow({ where: { userId } })).productIds).toEqual([
      a.id,
      c.id,
      b.id,
    ]);
  });

  it('FAV-01 · merge is idempotent', async () => {
    const [a, b] = [await mkProduct(), await mkProduct()];
    const first = (await mergeReq([a.id, b.id]).expect(200)).body;
    const second = (await mergeReq([a.id, b.id]).expect(200)).body;
    expect(second.productIds).toEqual(first.productIds);
    expect(second.total).toBe(2);
    expect(second.truncated).toBe(0);
  });

  it('FAV-01 · merge caps at 100 (existing first) and reports truncated', async () => {
    const products = [];
    for (let i = 0; i < 100; i++) products.push(await mkProduct());
    const existing = products.slice(0, 98).map((p) => p.id);
    await prisma.wishlist.create({ data: { userId, productIds: existing, version: 0 } });
    const res = await mergeReq(products.slice(95).map((p) => p.id)).expect(200);
    // 95..99 given, 95..97 already saved; 98 and 99 are new and fit exactly -> truncated 0
    expect(res.body.total).toBe(100);
    expect(res.body.truncated).toBe(0);
    const extra = await mkProduct();
    const extra2 = await mkProduct();
    const res2 = await mergeReq([extra.id, extra2.id]).expect(200);
    expect(res2.body).toMatchObject({ total: 100, truncated: 2, skipped: 0 });
    expect(res2.body.productIds).not.toContain(extra.id);
  });

  it('FAV-01 · rejects a body that is not {productIds: string[≤100]} with 422', async () => {
    await request(app).post(`${BASE}/merge`).set(auth(token)).send({}).expect(422);
    await request(app).post(`${BASE}/merge`).set(auth(token)).send({ productIds: 'x' }).expect(422);
    await request(app)
      .post(`${BASE}/merge`)
      .set(auth(token))
      .send({ productIds: Array(101).fill('a') })
      .expect(422);
    await request(app)
      .post(`${BASE}/merge`)
      .set(auth(token))
      .send({ productIds: [], extra: 1 })
      .expect(422);
  });

  it('FAV-01 · "merge" is routed as the static route, not as a product id', async () => {
    await request(app).put(`${BASE}/merge`).set(auth(token)).expect(404);
  });
});

describe('FAV-01 · concurrency', () => {
  it('FAV-01 · two writers racing both land (version retry); no lost update', async () => {
    const [a, b] = [await mkProduct(), await mkProduct()];
    await put(a.id); // row exists, version 0 -> 1
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let hit = 0;
    testHooks.beforeWrite = async (attempt) => {
      if (attempt === 0 && hit++ === 0) await gate;
    };
    try {
      const first = put(b.id).then((r) => r.status); // paused between read and write
      await vi.waitFor(() => expect(hit).toBe(1));
      const c = await mkProduct();
      await put(c.id).expect(200); // second writer wins the version
      release();
      expect(await first).toBe(200);
    } finally {
      testHooks.beforeWrite = undefined;
    }
    const ids = (await prisma.wishlist.findUniqueOrThrow({ where: { userId } })).productIds;
    expect(ids).toHaveLength(3);
  });

  it('FAV-01 · persistent conflicts end in 409 WISHLIST_CONFLICT', async () => {
    const [a, b] = [await mkProduct(), await mkProduct()];
    await put(a.id);
    testHooks.beforeWrite = async () => {
      await prisma.wishlist.updateMany({ where: { userId }, data: { version: { increment: 1 } } });
    };
    try {
      const res = await put(b.id).expect(409);
      expect(res.body.code).toBe('WISHLIST_CONFLICT');
    } finally {
      testHooks.beforeWrite = undefined;
    }
  });
});
