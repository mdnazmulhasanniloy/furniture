import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_sections_t011',
  );
});
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';
let categoryId = '';

const api = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/home-sections${path}`).set(
    'Authorization',
    `Bearer ${adminToken}`,
  );
};

const section = (overrides: Record<string, unknown> = {}) => ({
  type: 'NEW_ARRIVALS',
  title: { en: 'New arrivals', ar: 'وصل حديثاً' },
  ...overrides,
});

let productSeq = 0;
async function createProduct(overrides: Record<string, unknown> = {}) {
  productSeq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Product ${productSeq}`, ar: `منتج ${productSeq}` },
      description: { en: 'd', ar: 'و' },
      slug: `product-${productSeq}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10000,
      stock: 5,
      categoryId,
      images: [],
      status: 'PUBLISHED',
      // Distinct createdAt so "newest first" is deterministic.
      createdAt: new Date(Date.now() - (1000 - productSeq) * 60_000),
      ...overrides,
    },
  });
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
  const category = await prisma.category.create({
    data: { name: { en: 'Sofas', ar: 'أرائك' }, slug: 'sofas', parentId: null, image: null },
  });
  categoryId = category.id;
});
beforeEach(async () => {
  revalidateMock.mockClear();
  await prisma.homeSection.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.product.deleteMany();
  await prisma.rateLimit.deleteMany();
});
afterAll(async () => {
  await prisma.homeSection.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-07 · home sections', () => {
  it('ADM-07 · admin CRUD roundtrip; 401 without a token, 403 for a customer', async () => {
    await request(app).get('/api/v1/admin/home-sections').expect(401);
    await request(app)
      .get('/api/v1/admin/home-sections')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const created = await api('post').send(section({ config: { limit: 4 } }));
    expect(created.status).toBe(201);
    expect(created.body.config).toEqual({ limit: 4 });
    expect(created.body.isVisible).toBe(true);

    const patched = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      isVisible: false,
    });
    expect(patched.status).toBe(200);
    expect(patched.body.isVisible).toBe(false);

    expect((await api('get')).body).toHaveLength(1);
    await api('delete', `/${created.body.id}`).expect(204);
    expect((await api('get')).body).toHaveLength(0);
  });

  it('ADM-07 · reorder sets sortOrder by position; a partial, foreign or duplicated id set -> 422', async () => {
    const a = (await api('post').send(section({ sortOrder: 1 }))).body;
    const b = (await api('post').send(section({ sortOrder: 2 }))).body;
    const c = (await api('post').send(section({ sortOrder: 3 }))).body;

    await api('put', '/reorder')
      .send({ ids: [c.id, a.id, b.id] })
      .expect(204);
    const list = await api('get');
    expect(list.body.map((s: { id: string }) => s.id)).toEqual([c.id, a.id, b.id]);

    const partial = await api('put', '/reorder').send({ ids: [a.id, b.id] });
    expect(partial.status).toBe(422);
    const foreign = await api('put', '/reorder').send({
      ids: [a.id, b.id, '0123456789abcdef01234567'],
    });
    expect(foreign.status).toBe(422);
    const duplicated = await api('put', '/reorder').send({ ids: [a.id, a.id, b.id] });
    expect(duplicated.status).toBe(422);
    // Nothing changed by the failed calls.
    expect((await api('get')).body.map((s: { id: string }) => s.id)).toEqual([c.id, a.id, b.id]);
  });

  it('ADM-07 · FEATURED_PRODUCTS resolves config.productIds in the given order, PUBLISHED only', async () => {
    const p1 = await createProduct();
    const draft = await createProduct({ status: 'DRAFT' });
    const p3 = await createProduct();
    await api('post')
      .send(
        section({
          type: 'FEATURED_PRODUCTS',
          config: { productIds: [p3.id, draft.id, p1.id] },
        }),
      )
      .expect(201);

    const res = await request(app).get('/api/v1/cms/home');
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.sections[0].products.map((p: { id: string }) => p.id)).toEqual([p3.id, p1.id]);
  });

  it('ADM-07 · FEATURED_PRODUCTS without productIds falls back to featured products, newest first, limited', async () => {
    await createProduct(); // not featured
    const f1 = await createProduct({ isFeatured: true });
    const f2 = await createProduct({ isFeatured: true });
    const f3 = await createProduct({ isFeatured: true });
    await api('post')
      .send(section({ type: 'FEATURED_PRODUCTS', config: { limit: 2 } }))
      .expect(201);

    const res = await request(app).get('/api/v1/cms/home');
    expect(res.body.sections[0].products.map((p: { id: string }) => p.id)).toEqual([f3.id, f2.id]);
    expect(f1.isFeatured).toBe(true); // the limit, not the filter, excluded f1
  });

  it('ADM-07 · NEW_ARRIVALS and RESALE_PICKS return PUBLISHED products only, newest first', async () => {
    const n1 = await createProduct();
    await createProduct({ status: 'DRAFT' });
    const r1 = await createProduct({ type: 'RESALE', condition: 'GOOD' });
    await api('post')
      .send(section({ sortOrder: 1 }))
      .expect(201); // NEW_ARRIVALS
    await api('post')
      .send(section({ type: 'RESALE_PICKS', title: { en: 'Resale', ar: 'مستعمل' }, sortOrder: 2 }))
      .expect(201);

    const res = await request(app).get('/api/v1/cms/home');
    const [arrivals, resale] = res.body.sections;
    expect(arrivals.products.map((p: { id: string }) => p.id)).toEqual([r1.id, n1.id]);
    expect(resale.products.map((p: { id: string }) => p.id)).toEqual([r1.id]);
  });

  it('ADM-07 · CATEGORY_GRID returns active root categories, or config.categoryIds (active only, in order)', async () => {
    const inactive = await prisma.category.create({
      data: {
        name: { en: 'Hidden', ar: 'م' },
        slug: 'hidden',
        isActive: false,
        parentId: null,
        image: null,
      },
    });
    const child = await prisma.category.create({
      data: {
        name: { en: 'Child', ar: 'ف' },
        slug: 'child-cat',
        parentId: categoryId,
        image: null,
      },
    });
    const noConfig = await api('post').send(
      section({ type: 'CATEGORY_GRID', title: { en: 'Shop', ar: 'تسوق' }, sortOrder: 1 }),
    );
    expect(noConfig.status).toBe(201);
    const withIds = await api('post').send(
      section({
        type: 'CATEGORY_GRID',
        title: { en: 'Picked', ar: 'مختار' },
        sortOrder: 2,
        config: { categoryIds: [child.id, inactive.id, categoryId] },
      }),
    );
    expect(withIds.status).toBe(201);

    const res = await request(app).get('/api/v1/cms/home');
    const [roots, picked] = res.body.sections;
    // Roots only (the child is excluded), active only (the inactive root is excluded).
    expect(roots.categories.map((c: { id: string }) => c.id)).toEqual([categoryId]);
    // Explicit ids keep their order and drop inactive ones; a child may be picked explicitly.
    expect(picked.categories.map((c: { id: string }) => c.id)).toEqual([child.id, categoryId]);

    await prisma.category.deleteMany({ where: { id: { in: [inactive.id, child.id] } } });
  });

  it('ADM-07 · PROMO_BANNER resolves config.bannerId only when the banner is active and scheduled', async () => {
    const active = await prisma.banner.create({
      data: {
        title: { en: 'Promo', ar: 'عرض' },
        imageDesktop: { key: 'furnixa/test/2026/11/promo.webp', url: 'https://cdn.furnixa.test/p' },
      },
    });
    const inactive = await prisma.banner.create({
      data: {
        title: { en: 'Off', ar: 'م' },
        isActive: false,
        imageDesktop: { key: 'furnixa/test/2026/11/off.webp', url: 'https://cdn.furnixa.test/o' },
      },
    });
    await api('post')
      .send(
        section({
          type: 'PROMO_BANNER',
          title: { en: 'Promo', ar: 'عرض' },
          sortOrder: 1,
          config: { bannerId: active.id },
        }),
      )
      .expect(201);
    await api('post')
      .send(
        section({
          type: 'PROMO_BANNER',
          title: { en: 'Broken', ar: 'م' },
          sortOrder: 2,
          config: { bannerId: inactive.id },
        }),
      )
      .expect(201);

    const res = await request(app).get('/api/v1/cms/home');
    const [resolved, broken] = res.body.sections;
    expect(resolved.banner.id).toBe(active.id);
    // Missing/inactive banner: the property is omitted so the storefront skips the section.
    expect(broken.banner).toBeUndefined();
  });

  it('ADM-07 · TESTIMONIALS config passes through; hidden sections are excluded; order is sortOrder', async () => {
    const testimonials = [{ name: 'Sara', quote: { en: 'Great sofa', ar: 'أريكة رائعة' } }];
    await api('post')
      .send(
        section({
          type: 'TESTIMONIALS',
          title: { en: 'Clients', ar: 'عملاؤنا' },
          sortOrder: 2,
          config: { testimonials },
        }),
      )
      .expect(201);
    await api('post')
      .send(section({ sortOrder: 1 }))
      .expect(201);
    await api('post')
      .send(section({ title: { en: 'Hidden', ar: 'م' }, sortOrder: 0, isVisible: false }))
      .expect(201);

    const res = await request(app).get('/api/v1/cms/home');
    expect(res.body.sections).toHaveLength(2);
    expect(res.body.sections.map((s: { sortOrder: number }) => s.sortOrder)).toEqual([1, 2]);
    expect(res.body.sections[1].config.testimonials).toEqual(testimonials);
  });

  it('ADM-07 · stale PATCH gets 409 STALE_UPDATE and the first change survives', async () => {
    const created = await api('post').send(section()).expect(201);
    const loaded = created.body.updatedAt;
    await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: loaded, title: { en: 'First', ar: 'الأول' } })
      .expect(200);
    const second = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: loaded,
      title: { en: 'Second', ar: 'الثاني' },
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_UPDATE');
    expect(second.body.details.current.title.en).toBe('First');
  });

  it('ADM-07 · every admin write (incl. reorder) revalidates tag home', async () => {
    const created = await api('post').send(section()).expect(201);
    await api('put', '/reorder')
      .send({ ids: [created.body.id] })
      .expect(204);
    // Reorder touched updatedAt; reload before the optimistic-concurrent patch.
    const reloaded = (await api('get')).body[0];
    await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: reloaded.updatedAt, sortOrder: 7 })
      .expect(200);
    await api('delete', `/${created.body.id}`).expect(204);
    expect(revalidateMock).toHaveBeenCalledTimes(4);
    for (const call of revalidateMock.mock.calls) expect(call[0]).toEqual(['home']);
  });
});
