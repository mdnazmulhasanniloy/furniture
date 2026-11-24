import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_products_admin_images_t010',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { callsOf, resetS3, s3State } from '../helpers/s3Mock.js';

const app = createApp();
let adminToken = '';
let customerId = '';
let categoryId = '';

const api = (method: 'get' | 'post' | 'patch' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/products${path}`).set(
    'Authorization',
    `Bearer ${adminToken}`,
  );
};

const goodUpload = { fileName: 'product.webp', contentType: 'image/webp', size: 204800 };
const goodBody = (slug: string, extra: Record<string, unknown> = {}) => ({
  title: { en: `${slug} en`, ar: `${slug} ar` },
  description: { en: 'desc', ar: 'وصف' },
  slug,
  type: 'NEW',
  condition: 'NEW',
  price: 10_000,
  stock: 3,
  categoryId,
  ...extra,
});

/** Presign an admin upload and register the "uploaded" object in the mock store. */
async function presignedKey(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/uploads/presign')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(goodUpload);
  expect(res.status).toBe(200);
  const key = res.body.key as string;
  s3State.objects.set(key, { ContentType: goodUpload.contentType, ContentLength: goodUpload.size });
  return key;
}

async function orderShowing(productId: string, imageKey: string) {
  return prisma.order.create({
    data: {
      orderNo: `FX-20261122-${String(Math.floor(Math.random() * 9000) + 1000)}`,
      userId: customerId,
      idempotencyKey: crypto.randomUUID(),
      addressId: '0'.repeat(24),
      items: [
        {
          productId,
          titleSnapshot: { en: 'snap', ar: 'سناب' },
          sku: null,
          imageSnapshot: `${getEnv().R2_PUBLIC_BASE_URL}/${imageKey}`,
          imageKey,
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
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne!');
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
  customerId = customer.id;
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Tables', ar: 'طاولات' }, slug: 'tables', image: null, parentId: null },
    })
  ).id;
});
beforeEach(async () => {
  resetS3();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
});
afterAll(async () => {
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-02 · product images', () => {
  it('ADM-02 · create with image keys recomputes url, attaches the uploads and keeps alt and order', async () => {
    const key1 = await presignedKey();
    const key2 = await presignedKey();
    const res = await api('post').send(
      goodBody('coffee-table', {
        images: [{ key: key2, alt: { en: 'Front', ar: 'أمام' } }, { key: key1 }],
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.images).toHaveLength(2);
    expect(res.body.images[0]).toMatchObject({
      key: key2,
      url: `${getEnv().R2_PUBLIC_BASE_URL}/${key2}`,
      alt: { en: 'Front', ar: 'أمام' },
    });
    expect(res.body.images[1].key).toBe(key1);
    for (const key of [key1, key2]) {
      const row = await prisma.upload.findUniqueOrThrow({ where: { key } });
      expect(row.attachedAt).toBeInstanceOf(Date);
    }
  });

  it('ADM-02 · a key outside furnixa/{env}/, a missing object and an avatar-scope upload -> 422 UPLOAD_NOT_ALLOWED, nothing created', async () => {
    const foreign = await api('post').send(
      goodBody('x1', {
        images: [{ key: 'furnixa/production/2026/11/00000000-0000-4000-8000-000000000001.webp' }],
      }),
    );
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe('UPLOAD_NOT_ALLOWED');

    const presignRes = await request(app)
      .post('/api/v1/admin/uploads/presign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(goodUpload);
    const neverUploaded = presignRes.body.key as string; // row exists, HeadObject finds nothing
    const missing = await api('post').send(goodBody('x2', { images: [{ key: neverUploaded }] }));
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('UPLOAD_NOT_ALLOWED');

    const avatarKey = `furnixa/test/avatars/${customerId}/00000000-0000-4000-8000-00000000000a.webp`;
    await prisma.upload.create({
      data: {
        key: avatarKey,
        uploadedById: customerId,
        contentType: 'image/webp',
        size: 1000,
        scope: 'avatar',
        attachedAt: null,
      },
    });
    s3State.objects.set(avatarKey, { ContentType: 'image/webp', ContentLength: 1000 });
    const avatar = await api('post').send(goodBody('x3', { images: [{ key: avatarKey }] }));
    expect(avatar.status).toBe(422);
    expect(avatar.body.code).toBe('UPLOAD_NOT_ALLOWED');

    expect(await prisma.product.count()).toBe(0);
  });

  it('ADM-02 · re-saving with the same keys and reordering make no S3 calls', async () => {
    const key1 = await presignedKey();
    const key2 = await presignedKey();
    const created = await api('post').send(
      goodBody('sofa-set', { images: [{ key: key1 }, { key: key2 }] }),
    );
    expect(created.status).toBe(201);

    resetS3();
    const resave = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      images: [{ key: key1, alt: { en: 'Alt', ar: 'بديل' } }, { key: key2 }],
      price: 20_000,
    });
    expect(resave.status).toBe(200);
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);

    const reorder = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: resave.body.updatedAt,
      images: [{ key: key2 }, { key: key1 }],
    });
    expect(reorder.status).toBe(200);
    expect(reorder.body.images.map((i: { key: string }) => i.key)).toEqual([key2, key1]);
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
  });

  it('ADM-02 · an update that adds one and removes one attaches the new key and releases the removed one', async () => {
    const key1 = await presignedKey();
    const created = await api('post').send(goodBody('bench', { images: [{ key: key1 }] }));
    expect(created.status).toBe(201);

    const key2 = await presignedKey();
    const res = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      images: [{ key: key2 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.images.map((i: { key: string }) => i.key)).toEqual([key2]);
    expect(s3State.deleted).toContain(key1);
    expect(await prisma.upload.findUnique({ where: { key: key1 } })).toBeNull();
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: key2 } })).attachedAt,
    ).toBeInstanceOf(Date);
  });

  it('ADM-02 · deleting a product releases all its images; a failing DeleteObject keeps the row and still succeeds', async () => {
    const key1 = await presignedKey();
    const key2 = await presignedKey();
    const created = await api('post').send(
      goodBody('wardrobe', { images: [{ key: key1 }, { key: key2 }] }),
    );
    expect(created.status).toBe(201);
    s3State.failDelete.add(key2);

    const res = await api('delete', `/${created.body.id}`);
    expect(res.status).toBe(204);
    expect(await prisma.product.count()).toBe(0);
    expect(s3State.deleted).toContain(key1);
    expect(await prisma.upload.findUnique({ where: { key: key1 } })).toBeNull();
    // The failed delete keeps the row with attachedAt unset so the cron retries it (T-008).
    const kept = await prisma.upload.findUniqueOrThrow({ where: { key: key2 } });
    expect(kept.attachedAt).toBeNull();
  });

  it('ADM-02 · release runs only after commit: a rolled-back save (slug conflict) deletes nothing from R2', async () => {
    await api('post').send(goodBody('taken')).expect(201);
    const key1 = await presignedKey();
    const victim = await api('post').send(goodBody('victim', { images: [{ key: key1 }] }));
    expect(victim.status).toBe(201);

    // Patch that swaps the image AND hits the unique-slug conflict: the transaction rolls back.
    const key2 = await presignedKey();
    const res = await api('patch', `/${victim.body.id}`).send({
      expectedUpdatedAt: victim.body.updatedAt,
      slug: 'taken',
      images: [{ key: key2 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
    expect(s3State.objects.has(key1)).toBe(true);
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: key1 } })).attachedAt,
    ).toBeInstanceOf(Date);
    expect((await prisma.upload.findUniqueOrThrow({ where: { key: key2 } })).attachedAt).toBeNull();
    const db = await prisma.product.findUniqueOrThrow({ where: { id: victim.body.id } });
    expect(db.slug).toBe('victim');
    expect(db.images[0]?.key).toBe(key1);
  });

  it('ADM-02 · an R2 object referenced by an order item imageKey is never deleted: the Upload row is detached, the object kept', async () => {
    const referencedKey = await presignedKey();
    const freeKey = await presignedKey();
    const created = await api('post').send(
      goodBody('ordered-table', { images: [{ key: referencedKey }, { key: freeKey }] }),
    );
    expect(created.status).toBe(201);
    // An order snapshots the first image (T-013 will write imageKey; seeded directly until then).
    await orderShowing(created.body.id, referencedKey);
    // Remove both images from the product (the product itself stays): the release path runs.
    const res = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      images: [],
    });
    expect(res.status).toBe(200);
    // The free key is fully released; the referenced key is detached but its object survives.
    expect(s3State.deleted).toContain(freeKey);
    expect(s3State.deleted).not.toContain(referencedKey);
    expect(s3State.objects.has(referencedKey)).toBe(true);
    expect(await prisma.upload.findUnique({ where: { key: referencedKey } })).toBeNull();
    expect(await prisma.upload.findUnique({ where: { key: freeKey } })).toBeNull();
  });
});
