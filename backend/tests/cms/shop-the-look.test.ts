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
import * as service from '../../src/modules/cms/sections.service.js';
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

const hotspot = (i: number, x = 10 + i * 10, y = 50) => ({ x, y, productId: productIds[i]! });

/** The photo's own pixel size is required from T-110 on, so every fixture carries it. */
const img = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  alt,
  width: 1600,
  height: 1200,
  ...extra,
});

async function lookBody(overrides: Record<string, unknown> = {}) {
  return {
    type: 'SHOP_THE_LOOK',
    title: { en: 'Shop the look', ar: 'تسوّق هذا التنسيق' },
    config: {
      look: {
        image: img(await presignedKey()),
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
  // Seven, so the 6-point boundary can be tested with distinct products (T-110).
  for (let i = 0; i < 7; i++) productIds.push((await mkProduct(i)).id);
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

  it('ADM-15 · 1 to 6 hotspots, x and y within 0 to 100, valid product ids, localized alt text', async () => {
    const base = await lookBody();
    const bad = async (look: Record<string, unknown>) =>
      (await sections('post').send({ ...base, config: { look: { ...base.config.look, ...look } } }))
        .status;
    expect(await bad({ hotspots: [] })).toBe(422);
    expect(await bad({ hotspots: [{ x: -1, y: 10, productId: productIds[0] }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 101, productId: productIds[0] }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 10, productId: 'nope' }] })).toBe(422);
    expect(await bad({ hotspots: [{ x: 10, y: 10, productId: productIds[0], extra: 1 }] })).toBe(
      422,
    );
    expect(
      await bad({ image: img(base.config.look.image.key, { alt: { en: 'only english' } }) }),
    ).toBe(422);
    expect(await bad({ hotspots: [hotspot(0)] })).toBe(201);
  });

  it('T-110 · up to six points are allowed, a seventh is refused', async () => {
    const base = await lookBody();
    const withPoints = async (n: number) =>
      (
        await sections('post').send({
          ...base,
          config: {
            look: {
              ...base.config.look,
              image: img(await presignedKey()),
              hotspots: Array.from({ length: n }, (_, i) => hotspot(i)),
            },
          },
        })
      ).status;
    expect(await withPoints(6)).toBe(201);
    expect(await withPoints(7)).toBe(422);
    expect(await prisma.homeSection.count()).toBe(1);
  });

  it('T-110 · the photo carries its own pixel size: required, bounded, and returned on the asset', async () => {
    const base = await lookBody();
    const withImage = async (image: Record<string, unknown>) =>
      sections('post').send({ ...base, config: { look: { ...base.config.look, image } } });
    const key = base.config.look.image.key;
    expect((await withImage({ key, alt })).status).toBe(422); // no width/height at all
    expect((await withImage(img(key, { height: undefined }))).status).toBe(422);
    expect((await withImage(img(key, { width: 0 }))).status).toBe(422);
    expect((await withImage(img(key, { width: 20001 }))).status).toBe(422);
    expect((await withImage(img(key, { width: 1600.5 }))).status).toBe(422);

    const ok = await withImage(img(key, { width: 2400, height: 1600 }));
    expect(ok.status).toBe(201);
    expect(ok.body.config.look.image).toMatchObject({ width: 2400, height: 1600 });
    // The stored asset keeps them, so the storefront can render the photo uncropped.
    const stored = (await prisma.homeSection.findFirstOrThrow()).config as {
      look: { image: { width: number; height: number } };
    };
    expect(stored.look.image).toMatchObject({ width: 2400, height: 1600 });
  });

  it('T-110 · the same product twice in one look is refused; in another look it is fine', async () => {
    const base = await lookBody();
    const dup = await sections('post').send({
      ...base,
      config: {
        look: { ...base.config.look, hotspots: [hotspot(0), hotspot(1), hotspot(0, 80)] },
      },
    });
    expect(dup.status).toBe(422);
    expect(dup.body.code).toBe('DUPLICATE_PRODUCT');
    expect(dup.body.details.productIds).toEqual([productIds[0]]);
    expect(await prisma.homeSection.count()).toBe(0);

    // Two different looks may both point at that product.
    const first = await sections('post').send({
      ...(await lookBody()),
      config: { look: { image: img(await presignedKey()), hotspots: [hotspot(0)] } },
    });
    const second = await sections('post').send({
      ...(await lookBody()),
      config: { look: { image: img(await presignedKey()), hotspots: [hotspot(0)] } },
    });
    expect([first.status, second.status]).toEqual([201, 201]);
  });

  it('T-110 · a product that is not published at save time is refused, on create and on update', async () => {
    await prisma.product.update({ where: { id: productIds[1]! }, data: { status: 'DRAFT' } });
    const base = await lookBody();
    const res = await sections('post').send(base);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PRODUCT_NOT_PUBLISHED');
    expect(res.body.details.productIds).toEqual([productIds[1]]);
    expect(await prisma.homeSection.count()).toBe(0);
    // The photo of a refused save is never attached.
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: base.config.look.image.key } }))
        .attachedAt,
    ).toBeNull();

    // A deleted product is refused the same way.
    await prisma.product.delete({ where: { id: productIds[2]! } });
    const gone = await sections('post').send({
      ...(await lookBody()),
      config: { look: { image: img(await presignedKey()), hotspots: [hotspot(2)] } },
    });
    expect(gone.status).toBe(422);
    expect(gone.body.code).toBe('PRODUCT_NOT_PUBLISHED');

    // On update: a point added for a product unpublished a moment ago is refused and nothing changes.
    const created = await sections('post').send({
      ...(await lookBody()),
      config: { look: { image: img(await presignedKey()), hotspots: [hotspot(0)] } },
    });
    expect(created.status).toBe(201);
    const patched = await sections('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      config: {
        look: {
          image: img(created.body.config.look.image.key),
          hotspots: [hotspot(0), hotspot(1)],
        },
      },
    });
    expect(patched.status).toBe(422);
    expect(patched.body.code).toBe('PRODUCT_NOT_PUBLISHED');
    const row = await prisma.homeSection.findUniqueOrThrow({ where: { id: created.body.id } });
    expect((row.config as { look: { hotspots: unknown[] } }).look.hotspots).toHaveLength(1);
    expect(s3State.deleted).toEqual([]);
  });

  it('T-110 · the admin response carries each point’s current product, and flags one that fell out', async () => {
    const created = await sections('post').send(await lookBody());
    expect(created.status).toBe(201);
    const onCreate = created.body.config.look.hotspots;
    expect(onCreate.map((h: { product: { id: string } }) => h.product.id)).toEqual([
      productIds[0],
      productIds[1],
      productIds[2],
    ]);
    expect(onCreate[0].product).toMatchObject({
      id: productIds[0],
      slug: 'look-chair-0',
      price: 10_000,
      status: 'PUBLISHED',
      title: { en: 'Chair 0', ar: 'كرسي 0' },
    });
    expect(onCreate[0].product.image).toBeDefined(); // null when the product has no photo
    expect(onCreate[0].product.passwordHash).toBeUndefined();

    // The list says so too, and a product that is unpublished or deleted later is visible as such.
    await prisma.product.update({ where: { id: productIds[1]! }, data: { status: 'DRAFT' } });
    await prisma.product.delete({ where: { id: productIds[2]! } });
    const list = await sections('get');
    const spots = list.body[0].config.look.hotspots;
    expect(spots).toHaveLength(3); // the admin still sees every point they placed
    expect(spots[1].product.status).toBe('DRAFT');
    expect(spots[2].product).toBeNull(); // deleted: the editor offers to replace it
  });

  it('T-110 · a client-sent product on a hotspot is rejected, the server is the only source', async () => {
    const base = await lookBody();
    const res = await sections('post').send({
      ...base,
      config: {
        look: {
          ...base.config.look,
          hotspots: [{ ...hotspot(0), product: { id: productIds[0], price: 1 } }],
        },
      },
    });
    expect(res.status).toBe(422);
  });

  it('T-110 · saving and deleting a look each log one audit line: who, which section, how many points', async () => {
    const info = vi.fn();
    const log = { info, error: vi.fn() } as unknown as Parameters<typeof service.create>[1]['log'];
    const ctx = { log, requestId: 'req-look', uploadedById: 'actor-1' };
    const body = await lookBody();
    const created = await service.create(
      { ...body, config: body.config } as unknown as Parameters<typeof service.create>[0],
      ctx,
    );
    const { release } = await service.remove(created.id, ctx);
    await release();

    expect(info).toHaveBeenCalledTimes(2);
    const calls = info.mock.calls as [Record<string, unknown>, string][];
    expect(calls.map(([o]) => o.event)).toEqual(['section.look.save', 'section.look.delete']);
    for (const [obj, msg] of calls) {
      expect(obj).toMatchObject({
        actorId: 'actor-1',
        targetId: created.id,
        points: 3,
        requestId: 'req-look',
      });
      expect(obj.productIds).toEqual([productIds[0], productIds[1], productIds[2]]);
      expect(typeof obj.at).toBe('string');
      expect(msg).toBe(obj.event);
      // The line is about the change, not its content: no photo key, no copy.
      expect(JSON.stringify([obj, msg])).not.toContain(body.config.look.image.key);
    }
  });

  it('T-110 · a section that is not a look writes no look audit line', async () => {
    const info = vi.fn();
    const log = { info, error: vi.fn() } as unknown as Parameters<typeof service.create>[1]['log'];
    const ctx = { log, requestId: 'req-plain', uploadedById: 'actor-1' };
    const plain = await service.create(
      { type: 'NEW_ARRIVALS', title: { en: 'New', ar: 'جديد' } } as unknown as Parameters<
        typeof service.create
      >[0],
      ctx,
    );
    const { release } = await service.remove(plain.id, ctx);
    await release();
    expect(info).not.toHaveBeenCalled();
  });

  it('T-110 · admin only on every write: 401 without a token, 403 for a customer', async () => {
    const created = await sections('post').send(await lookBody());
    const id = created.body.id as string;
    const patch = { expectedUpdatedAt: created.body.updatedAt, isVisible: false };
    const paths: ['patch' | 'delete' | 'put', string, object | undefined][] = [
      ['patch', `/${id}`, patch],
      ['delete', `/${id}`, undefined],
      ['put', '/reorder', { ids: [id] }],
    ];
    for (const [method, path, body] of paths) {
      const url = `/api/v1/admin/home-sections${path}`;
      const anon = await request(app)[method](url).send(body);
      expect([method, anon.status]).toEqual([method, 401]);
      const agent = request(app);
      const cust = await agent[method](url)
        .set('Authorization', `Bearer ${customerToken}`)
        .send(body);
      expect([method, cust.status]).toEqual([method, 403]);
    }
    expect(await prisma.homeSection.count()).toBe(1); // nothing of the above went through
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
      config: { look: { image: img(newKey), hotspots: [hotspot(0)] } },
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
      config: { look: { image: img(key), hotspots: [hotspot(1), hotspot(2)] } },
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
      config: { look: { image: img(await presignedKey()), hotspots: [hotspot(0)] } },
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
      [10, 50],
      [20, 50],
      [30, 50],
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
