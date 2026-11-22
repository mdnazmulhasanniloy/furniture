import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_products_admin_crud_t010',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
let adminToken = '';
let customerToken = '';
let customerId = '';
let categoryId = '';

const api = (method: 'get' | 'post' | 'patch' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/products${path}`).set(
    'Authorization',
    `Bearer ${adminToken}`,
  );
};

const goodBody = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: { en: `${slug} en`, ar: `${slug} ar` },
  description: { en: 'A fine piece', ar: 'قطعة جميلة' },
  slug,
  type: 'NEW',
  condition: 'NEW',
  price: 10_000,
  stock: 3,
  categoryId,
  ...extra,
});

const stampOf = async (id: string) =>
  (await prisma.product.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

async function createProduct(slug: string, extra: Record<string, unknown> = {}) {
  const res = await api('post').send(goodBody(slug, extra));
  expect(res.status).toBe(201);
  return res.body as { id: string; updatedAt: string; slug: string };
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne');
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'admin@example.com',
      passwordHash: hash,
      isVerified: true,
      role: 'ADMIN',
    },
  });
  const customer = await prisma.user.create({
    data: {
      firstName: 'Cust',
      lastName: 'One',
      email: 'cust@example.com',
      passwordHash: hash,
      isVerified: true,
    },
  });
  adminToken = signAccessToken(admin);
  customerToken = signAccessToken(customer);
  customerId = customer.id;
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Chairs', ar: 'كراسي' }, slug: 'chairs', image: null, parentId: null },
    })
  ).id;
});
beforeEach(async () => {
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.rateLimit.deleteMany();
});
afterAll(async () => {
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-02 · admin products CRUD', () => {
  it('ADM-02 · requires an admin: anonymous -> 401, customer -> 403', async () => {
    expect((await request(app).get('/api/v1/admin/products')).status).toBe(401);
    const res = await request(app)
      .get('/api/v1/admin/products')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });

  it('ADM-02 · create returns 201 with the stored product; optional fields are explicit null in MongoDB (rule 8)', async () => {
    const res = await api('post').send(goodBody('side-chair'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      slug: 'side-chair',
      status: 'DRAFT',
      isFeatured: false,
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
      category: { slug: 'chairs' },
    });
    expect(typeof res.body.updatedAt).toBe('string');
    expect(res.body.searchText).toBeUndefined();
    // Regression (CLAUDE.md rule 8): the raw document carries the fields with an explicit null.
    const [raw] = (await prisma.product.findRaw({
      filter: { slug: 'side-chair' },
    })) as unknown as Record<string, unknown>[];
    for (const field of [
      'sku',
      'conditionNotes',
      'compareAtPrice',
      'dimensions',
      'material',
      'color',
    ]) {
      expect(raw).toHaveProperty(field, null);
    }
  });

  it('ADM-02 · admin list includes drafts and archived and filters by q, status and type', async () => {
    await createProduct('pub-chair', { status: 'PUBLISHED' });
    await createProduct('draft-chair');
    await createProduct('old-stool', {
      status: 'ARCHIVED',
      type: 'RESALE',
      condition: 'FAIR',
      title: { en: 'Vintage Stool', ar: 'مقعد قديم' },
    });

    const all = await api('get');
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(3);
    expect(all.body.meta.total).toBe(3);

    const drafts = await api('get').query({ status: 'DRAFT' });
    expect(drafts.body.items.map((i: { slug: string }) => i.slug)).toEqual(['draft-chair']);

    const resale = await api('get').query({ type: 'RESALE' });
    expect(resale.body.items.map((i: { slug: string }) => i.slug)).toEqual(['old-stool']);

    const byQ = await api('get').query({ q: 'vintage' });
    expect(byQ.body.items.map((i: { slug: string }) => i.slug)).toEqual(['old-stool']);
  });

  it('ADM-02 · duplicate slug -> 409 SLUG_TAKEN on create and on update', async () => {
    await createProduct('taken');
    const other = await createProduct('other');
    const dup = await api('post').send(goodBody('taken'));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SLUG_TAKEN');
    const patched = await api('patch', `/${other.id}`).send({
      expectedUpdatedAt: other.updatedAt,
      slug: 'taken',
    });
    expect(patched.status).toBe(409);
    expect(patched.body.code).toBe('SLUG_TAKEN');
  });

  it('ADM-02 · unknown categoryId -> 422; malformed or unknown id -> 404', async () => {
    const unknownCat = await api('post').send(
      goodBody('x1', { categoryId: 'ffffffffffffffffffffffff' }),
    );
    expect(unknownCat.status).toBe(422);
    expect(unknownCat.body.code).toBe('VALIDATION_ERROR');

    expect((await api('get', '/not-an-id')).status).toBe(404);
    expect((await api('get', '/ffffffffffffffffffffffff')).status).toBe(404);
    expect(
      (
        await api('patch', '/ffffffffffffffffffffffff').send({
          expectedUpdatedAt: new Date().toISOString(),
          stock: 1,
        })
      ).status,
    ).toBe(404);
    expect((await api('delete', '/not-an-id')).status).toBe(404);
  });

  it('ADM-02 · get by id returns drafts too', async () => {
    const draft = await createProduct('a-draft');
    const res = await api('get', `/${draft.id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.category.slug).toBe('chairs');
  });

  it('ADM-02 · body validation: limits, unknown fields and empty patch -> 422', async () => {
    for (const bad of [
      goodBody('b1', { price: -1 }),
      goodBody('b2', { price: 100_000_001 }),
      goodBody('b3', { stock: -1 }),
      goodBody('b4', { stock: 100_001 }),
      goodBody('b5', { slug: 'Bad Slug!' }),
      goodBody('b6', { compareAtPrice: 10_000 }), // not greater than price
      goodBody('b7', { images: Array.from({ length: 9 }, (_, i) => ({ key: `k${i}.webp` })) }),
      goodBody('b8', { url: 'https://evil.example' }), // unknown field
      goodBody('b9', { title: { en: 'x'.repeat(121), ar: 'y' } }),
    ]) {
      const res = await api('post').send(bad);
      expect(res.status, JSON.stringify(bad.slug)).toBe(422);
    }
    const p = await createProduct('valid');
    const emptyPatch = await api('patch', `/${p.id}`).send({ expectedUpdatedAt: p.updatedAt });
    expect(emptyPatch.status).toBe(422);
    const unknownField = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      searchText: 'hack',
    });
    expect(unknownField.status).toBe(422);
  });

  it('ADM-02 · type/condition consistency on create: NEW⇔NEW, RESALE⇔LIKE_NEW/GOOD/FAIR', async () => {
    const newBad = await api('post').send(goodBody('n1', { type: 'NEW', condition: 'GOOD' }));
    expect(newBad.status).toBe(422);
    expect(newBad.body.code).toBe('VALIDATION_ERROR');
    const resaleBad = await api('post').send(goodBody('r1', { type: 'RESALE', condition: 'NEW' }));
    expect(resaleBad.status).toBe(422);
    const ok = await api('post').send(goodBody('r2', { type: 'RESALE', condition: 'LIKE_NEW' }));
    expect(ok.status).toBe(201);
  });

  it('ADM-02 · type/condition consistency is checked on the merged patch result', async () => {
    const p = await createProduct('merge-check'); // NEW / NEW
    const badType = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      type: 'RESALE', // merged condition stays NEW -> invalid
    });
    expect(badType.status).toBe(422);
    const ok = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      type: 'RESALE',
      condition: 'GOOD',
    });
    expect(ok.status).toBe(200);
    const badCondition = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: ok.body.updatedAt,
      condition: 'NEW', // merged type is RESALE -> invalid
    });
    expect(badCondition.status).toBe(422);
  });

  it('ADM-02 · compareAtPrice must stay greater than price on the merged patch result', async () => {
    const p = await createProduct('priced', { compareAtPrice: 20_000 });
    const bad = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      price: 20_000, // equals merged compareAtPrice
    });
    expect(bad.status).toBe(422);
    const ok = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      price: 19_999,
    });
    expect(ok.status).toBe(200);
  });

  it('I18N-02 · DRAFT needs at least one non-empty locale for title and description', async () => {
    const bothEmpty = await api('post').send(
      goodBody('d1', { title: { en: '', ar: '  ' }, status: 'DRAFT' }),
    );
    expect(bothEmpty.status).toBe(422);
    const emptyDescription = await api('post').send(
      goodBody('d2', { description: { en: '', ar: '' } }),
    );
    expect(emptyDescription.status).toBe(422);
    const arOnly = await api('post').send(
      goodBody('d3', { title: { en: '', ar: 'كرسي' }, description: { en: '', ar: 'وصف' } }),
    );
    expect(arOnly.status).toBe(201);
    const enOnly = await api('post').send(goodBody('d4', { title: { en: 'Chair', ar: '' } }));
    expect(enOnly.status).toBe(201);
  });

  it('I18N-02 · PUBLISHED needs both locales; publishing a half-translated draft -> 422, filled -> 200', async () => {
    const direct = await api('post').send(
      goodBody('p1', { title: { en: 'Chair', ar: '' }, status: 'PUBLISHED' }),
    );
    expect(direct.status).toBe(422);

    const draft = await createProduct('p2', { title: { en: '', ar: 'كرسي' } });
    const publishBare = await api('patch', `/${draft.id}`).send({
      expectedUpdatedAt: draft.updatedAt,
      status: 'PUBLISHED',
    });
    expect(publishBare.status).toBe(422);
    const publishFilled = await api('patch', `/${draft.id}`).send({
      expectedUpdatedAt: draft.updatedAt,
      status: 'PUBLISHED',
      title: { en: 'Chair', ar: 'كرسي' },
    });
    expect(publishFilled.status).toBe(200);
    expect(publishFilled.body.status).toBe('PUBLISHED');
  });

  it('ADM-02 · patch updates a subset and recomputes searchText from the new title', async () => {
    const p = await createProduct('renameable', { status: 'PUBLISHED' });
    const res = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      title: { en: 'Walnut Bookshelf', ar: 'مكتبة جوز' },
      price: 42_000,
    });
    expect(res.status).toBe(200);
    expect(res.body.price).toBe(42_000);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.searchText).toContain('walnut bookshelf');
    expect(row.searchText).toContain('مكتبه جوز'); // ة normalised to ه
    // The public search finds it under the new title.
    const found = await request(app).get('/api/v1/products').query({ q: 'walnut' });
    expect(found.body.items.map((i: { id: string }) => i.id)).toContain(p.id);
  });

  it('ADM-02 · a patch with a stale expectedUpdatedAt returns 409 and changes nothing', async () => {
    const p = await createProduct('contended');
    const first = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      price: 11_000,
    });
    expect(first.status).toBe(200);
    expect(first.body.updatedAt).not.toBe(p.updatedAt);
    // Second admin still holds the original updatedAt.
    const stale = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: p.updatedAt,
      price: 99_000,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
    expect(stale.body.details.current).toMatchObject({ id: p.id, price: 11_000 });
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.price).toBe(11_000);
  });

  it('ADM-02 · a stock decrement between load and save causes 409, not an overwrite', async () => {
    const p = await createProduct('stocked', { stock: 5 });
    const loaded = await stampOf(p.id);
    // A sale decrements the stock after the admin loaded the form (future T-013 behaviour).
    await prisma.product.update({ where: { id: p.id }, data: { stock: { decrement: 1 } } });
    expect(await stampOf(p.id)).not.toBe(loaded);
    const res = await api('patch', `/${p.id}`).send({
      expectedUpdatedAt: loaded,
      stock: 5, // would silently restore the sold unit
      price: 12_345,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_UPDATE');
    expect(res.body.details.current.stock).toBe(4);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.stock).toBe(4);
    expect(row.price).toBe(10_000);
  });

  it('ADM-02 · delete without orders removes the product (204)', async () => {
    const p = await createProduct('short-lived');
    expect((await api('delete', `/${p.id}`)).status).toBe(204);
    expect(await prisma.product.findUnique({ where: { id: p.id } })).toBeNull();
    expect((await api('delete', `/${p.id}`)).status).toBe(404);
  });

  it('ADM-02 · delete with the product in an order archives it instead (204, images kept)', async () => {
    const p = await createProduct('ordered-once', { status: 'PUBLISHED' });
    await prisma.order.create({
      data: {
        orderNo: 'FX-20261122-0001',
        userId: customerId,
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
        addressId: '0'.repeat(24),
        items: [
          {
            productId: p.id,
            titleSnapshot: { en: 'ordered-once en', ar: 'ordered-once ar' },
            sku: null,
            imageSnapshot: null,
            imageKey: null,
            unitPrice: 10_000,
            qty: 1,
            lineTotal: 10_000,
            type: 'NEW',
            condition: 'NEW',
          },
        ],
        address: {
          fullName: 'Cust One',
          phone: '+966500000000',
          cityCode: 'riyadh',
          city: { en: 'Riyadh', ar: 'الرياض' },
          area: 'Area',
          street: 'Street',
          notes: null,
        },
        subtotal: 10_000,
        deliveryFee: 0,
        vat: {
          vatRate: 0,
          vatAmount: 0,
          applyToDelivery: true,
          pricesIncludeVat: true,
          registrationNumber: null,
        },
        total: 10_000,
        statusHistory: [],
      },
    });
    expect((await api('delete', `/${p.id}`)).status).toBe(204);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe('ARCHIVED');
    // Archived products disappear from the public catalog but stay in the admin list.
    expect((await request(app).get(`/api/v1/products/${p.slug}`)).status).toBe(404);
  });
});
