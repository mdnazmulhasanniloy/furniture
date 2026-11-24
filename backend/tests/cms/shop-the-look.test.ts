import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_look_t080',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { callsOf, resetS3, s3State } from '../helpers/s3Mock.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';
let categoryId = '';
const productIds: string[] = [];

const sections = (method: 'get' | 'post' | 'patch' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/home-sections${path}`).set(
    'Authorization',
    `Bearer ${adminToken}`,
  );
};

const alt = { en: 'A living room', ar: 'غرفة معيشة' };
const upload = { fileName: 'look.webp', contentType: 'image/webp', size: 204800 };

async function presignedKey(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/uploads/presign')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(upload);
  expect(res.status).toBe(200);
  const key = res.body.key as string;
  s3State.objects.set(key, { ContentType: upload.contentType, ContentLength: upload.size });
  return key;
}

const hotspot = (i: number, x = 20 + i * 20, y = 50) => ({ x, y, productId: productIds[i]! });

async function lookBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'SHOP_THE_LOOK',
    title: { en: 'Shop the look', ar: 'تسوّق هذا التنسيق' },
    config: {
      look: {
        image: { key: await presignedKey(), alt },
        hotspots: [hotspot(0), hotspot(1), hotspot(2)],
      },
    },
    ...overrides,
  };
}

async function mkProduct(n: number, status: 'PUBLISHED' | 'DRAFT' = 'PUBLISHED') {
  return prisma.product.create({
    data: {
      title: { en: `Chair ${n}`, ar: `كرسي ${n}` },
      description: { en: 'd', ar: 'د' },
      slug: `look-chair-${n}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10_000 + n,
      stock: 5,
      categoryId,
      status,
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
    },
  });
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne!');
  const mk = (email: string, role: 'ADMIN' | 'CUSTOMER') =>
    prisma.user.create({
      data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true, role },
    });
  adminToken = signAccessToken(await mk('admin@example.com', 'ADMIN'));
  customerToken = signAccessToken(await mk('cust@example.com', 'CUSTOMER'));
});

beforeEach(async () => {
  resetS3();
  revalidateMock.mockClear();
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.homeSection.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Chairs', ar: 'كراسي' }, slug: 'chairs', image: null, parentId: null },
    })
  ).id;
  productIds.length = 0;
  for (let i = 0; i < 4; i++) productIds.push((await mkProduct(i)).id);
});

afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.homeSection.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-15 · shop the look: admin API', () => {
  it('ADM-15 · create stores the photo as an ImageAsset with a server-built url and attaches the upload', async () => {
    const body = await lookBody();
    const res = await sections('post').send(body);
    expect(res.status).toBe(201);
    const image = res.body.config.look.image;
    expect(image.key).toBe(body.config.look.image.key);
    expect(image.url).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${image.key}`);
    expect(image.alt).toEqual(alt);
    expect(res.body.config.look.hotspots).toHaveLength(3);
    const row = await prisma.upload.findUniqueOrThrow({ where: { key: image.key } });
    expect(row.attachedAt).not.toBeNull();
    expect(revalidateMock).toHaveBeenCalledWith(['home'], expect.anything());
  });

  it('ADM-15 · a client-supplied url is rejected, the server never stores a foreign image url', async () => {
    const body = await lookBody();
    (body.config.look.image as Record<string, unknown>).url = 'https://evil.example/x.jpg';
    expect((await sections('post').send(body)).status).toBe(422);
  });

  it('ADM-15 · a key outside this deployment is rejected with 422', async () => {
    const body = await lookBody();
    body.config.look.image.key = 'furnixa/other-env/2026/11/x.webp';
    const res = await sections('post').send(body);
    expect(res.status).toBe(422);
    expect(await prisma.homeSection.count()).toBe(0);
  });

  it('ADM-15 · SHOP_THE_LOOK requires config.look; other types reject it', async () => {
    const noLook = await sections('post').send({
      type: 'SHOP_THE_LOOK',
      title: { en: 'a', ar: 'ب' },
    });
    expect(noLook.status).toBe(422);
    const wrongType = await sections('post').send({ ...(await lookBody()), type: 'NEW_ARRIVALS' });
    expect(wrongType.status).toBe(422);
  });

  it('ADM-15 · 1 to 4 hotspots, x and y within 0 to 100, valid product ids, localized alt text', async () => {
    const base = await lookBody();
    const bad = async (look: Record<string, unknown>) =>
      (await sections('post').send({ ...base, config: { look: { ...base.config.look, ...look } } }))
        .status;
    expect(await bad({ hotspots: [] })).toBe(422);
    expect(await bad({ hotspots: [0, 1, 2, 3, 4].map((i) => hotspot(i % 4)) })).toBe(422);
    expect(await bad({ hotspots: [{ x: -1, y: 10, productId: productIds[0] }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 101, productId: productIds[0] }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 10, productId: 'nope' }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 10, productId: productIds[0], extra: 1 }] })).toBe(
      422,
    );
    expect(
      await bad({ image: { key: base.config.look.image.key, alt: { en: 'only english' } } }),
    ).toBe(422);
    expect(await bad({ hotspots: [hotspot(0)] })).toBe(201);
  });

  it('ADM-15 · admin only: 401 without a token, 403 for a customer', async () => {
    const body = await lookBody();
    expect((await request(app).post('/api/v1/admin/home-sections').send(body)).status).toBe(401);
    const res = await request(app)
      .post('/api/v1/admin/home-sections')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body);
    expect(res.status).toBe(403);
  });

  it('ADM-15 · replacing the photo attaches the new one and releases the old; deleting releases the photo', async () => {
    const created = await sections('post').send(await lookBody());
    const oldKey = created.body.config.look.image.key as string;
    const newKey = await presignedKey();
    const patched = await sections('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      config: { look: { image: { key: newKey, alt }, hotspots: [hotspot(0)] } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.config.look.image.key).toBe(newKey);
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: newKey } })).attachedAt,
    ).not.toBeNull();
    expect(s3State.deleted).toEqual([oldKey]);

    const del = await sections('delete', `/${created.body.id}`);
    expect(del.status).toBe(204);
    expect(s3State.deleted).toEqual([oldKey, newKey]);
    expect(await prisma.homeSection.count()).toBe(0);
  });

  it('ADM-15 · patching only the hotspots keeps the photo (no HeadObject, no delete)', async () => {
    const created = await sections('post').send(await lookBody());
    const key = created.body.config.look.image.key as string;
    const headBefore = callsOf('HeadObjectCommand').length;
    const patched = await sections('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      config: { look: { image: { key, alt }, hotspots: [hotspot(1), hotspot(2)] } },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.config.look.hotspots).toHaveLength(2);
    expect(callsOf('HeadObjectCommand')).toHaveLength(headBefore);
    expect(s3State.deleted).toEqual([]);
  });

  it('ADM-15 · changing the type away from SHOP_THE_LOOK while the look is stored is refused', async () => {
    const created = await sections('post').send(await lookBody());
    const res = await sections('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      type: 'NEW_ARRIVALS',
    });
    expect(res.status).toBe(422);
  });

  it('ADM-15 · a stale expectedUpdatedAt is a 409 and nothing is released', async () => {
    const created = await sections('post').send(await lookBody());
    const res = await sections('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
      config: { look: { image: { key: await presignedKey(), alt }, hotspots: [hotspot(0)] } },
    });
    expect(res.status).toBe(409);
    expect(s3State.deleted).toEqual([]);
  });
});

describe('ADM-15 · shop the look: public GET /cms/home', () => {
  const home = async () =>
    (await request(app).get('/api/v1/cms/home')).body as {
      sections: {
        type: string;
        look?: {
          image: { url: string };
          hotspots: { x: number; y: number; product: { id: string; title: { en: string } } }[];
        };
      }[];
    };

  it('ADM-15 · each hotspot resolves to its PUBLISHED product, in the admin order, with x and y', async () => {
    await sections('post').send(await lookBody());
    const look = (await home()).sections.find((s) => s.type === 'SHOP_THE_LOOK')!.look!;
    expect(look.hotspots.map((h) => h.product.id)).toEqual([
      productIds[0],
      productIds[1],
      productIds[2],
    ]);
    expect(look.hotspots.map((h) => [h.x, h.y])).toEqual([
      [20, 50],
      [40, 50],
      [60, 50],
    ]);
    expect(look.hotspots[0]!.product.title.en).toBe('Chair 0');
    expect(look.image.url).toMatch(/^https?:\/\//);
  });

  it('ADM-15 · a hotspot whose product is unpublished or deleted is dropped', async () => {
    await sections('post').send(await lookBody());
    await prisma.product.update({ where: { id: productIds[0]! }, data: { status: 'DRAFT' } });
    await prisma.product.delete({ where: { id: productIds[1]! } });
    const look = (await home()).sections.find((s) => s.type === 'SHOP_THE_LOOK')!.look!;
    expect(look.hotspots.map((h) => h.product.id)).toEqual([productIds[2]]);
  });

  it('ADM-15 · with no hotspot left the look is omitted (the storefront hides the section)', async () => {
    await sections('post').send(await lookBody());
    await prisma.product.updateMany({ data: { status: 'DRAFT' } });
    const section = (await home()).sections.find((s) => s.type === 'SHOP_THE_LOOK')!;
    expect(section).toBeDefined();
    expect(section.look).toBeUndefined();
  });

  it('ADM-15 · a hidden look section is not returned', async () => {
    const created = await sections('post').send(await lookBody({ isVisible: false }));
    expect(created.status).toBe(201);
    expect((await home()).sections.find((s) => s.type === 'SHOP_THE_LOOK')).toBeUndefined();
  });

  it('ADM-15 · a malformed stored config never makes the home page fail', async () => {
    await prisma.homeSection.create({
      data: {
        type: 'SHOP_THE_LOOK',
        title: { en: 'x', ar: 'س' },
        subtitle: null,
        config: { look: { image: { url: 'x' }, hotspots: 'nope' } },
        sortOrder: 1,
        isVisible: true,
      },
    });
    const res = await request(app).get('/api/v1/cms/home');
    expect(res.status).toBe(200);
    expect(res.body.sections[0].look).toBeUndefined();
  });
});
