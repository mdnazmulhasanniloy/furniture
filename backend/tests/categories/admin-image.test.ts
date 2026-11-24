import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_categories_image_t009',
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

const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/categories${path}`).set(
    'Authorization',
    `Bearer ${adminToken}`,
  );
};
const goodBody = (slug: string) => ({ name: { en: `${slug} en`, ar: `${slug} ar` }, slug });
const good = { fileName: 'cat.webp', contentType: 'image/webp', size: 102400 };

/** Presign an admin upload and register the "uploaded" object in the mock store. */
async function presignedKey(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/uploads/presign')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(good);
  expect(res.status).toBe(200);
  const key = res.body.key as string;
  s3State.objects.set(key, { ContentType: good.contentType, ContentLength: good.size });
  return key;
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
});
beforeEach(async () => {
  resetS3();
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.category.deleteMany();
});
afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-03 · category image', () => {
  it('ADM-03 · create with an image key recomputes url, attaches the upload and keeps alt', async () => {
    const key = await presignedKey();
    const res = await api('post', '').send({
      ...goodBody('living-room'),
      image: { key, alt: { en: 'Living room', ar: 'غرفة المعيشة' } },
    });
    expect(res.status).toBe(201);
    expect(res.body.image.key).toBe(key);
    expect(res.body.image.url).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${key}`);
    expect(res.body.image.alt).toEqual({ en: 'Living room', ar: 'غرفة المعيشة' });
    const row = await prisma.upload.findUniqueOrThrow({ where: { key } });
    expect(row.attachedAt).toBeInstanceOf(Date);
  });

  it('ADM-03 · a key outside furnixa/{env}/ and a missing object are rejected with 422 UPLOAD_NOT_ALLOWED', async () => {
    const foreign = await api('post', '').send({
      ...goodBody('x1'),
      image: { key: 'furnixa/production/2026/11/00000000-0000-4000-8000-000000000001.webp' },
    });
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe('UPLOAD_NOT_ALLOWED');

    // Presigned but never uploaded: the Upload row exists, HeadObject finds nothing.
    const res = await request(app)
      .post('/api/v1/admin/uploads/presign')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(good);
    const neverUploaded = res.body.key as string;
    const missing = await api('post', '').send({
      ...goodBody('x2'),
      image: { key: neverUploaded },
    });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('UPLOAD_NOT_ALLOWED');
    expect(await prisma.category.count()).toBe(0);
  });

  it('ADM-03 · an avatar-scope upload cannot be used as a category image (422)', async () => {
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
    const res = await api('post', '').send({ ...goodBody('x3'), image: { key: avatarKey } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('ADM-03 · replacing the image releases the old R2 object; removing it (image: null) does too', async () => {
    const key1 = await presignedKey();
    const created = await api('post', '').send({
      ...goodBody('living-room'),
      image: { key: key1 },
    });
    expect(created.status).toBe(201);

    const key2 = await presignedKey();
    const replaced = await api('patch', `/${created.body.id}`).send({ image: { key: key2 } });
    expect(replaced.status).toBe(200);
    expect(replaced.body.image.key).toBe(key2);
    expect(s3State.deleted).toContain(key1);
    expect(await prisma.upload.findUnique({ where: { key: key1 } })).toBeNull();
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: key2 } })).attachedAt,
    ).toBeInstanceOf(Date);

    const removed = await api('patch', `/${created.body.id}`).send({ image: null });
    expect(removed.status).toBe(200);
    expect(removed.body.image).toBeNull();
    expect(s3State.deleted).toContain(key2);
    expect(await prisma.upload.findUnique({ where: { key: key2 } })).toBeNull();
  });

  it('ADM-03 · deleting the category releases its image', async () => {
    const key = await presignedKey();
    const created = await api('post', '').send({ ...goodBody('outdoor'), image: { key } });
    expect(created.status).toBe(201);
    const res = await api('delete', `/${created.body.id}`);
    expect(res.status).toBe(204);
    expect(s3State.deleted).toContain(key);
    expect(await prisma.upload.findUnique({ where: { key } })).toBeNull();
    expect(await prisma.category.count()).toBe(0);
  });

  it('ADM-03 · a failing DeleteObject is logged, the request still succeeds and the row is kept for the cron', async () => {
    const key = await presignedKey();
    const created = await api('post', '').send({ ...goodBody('dining'), image: { key } });
    expect(created.status).toBe(201);
    s3State.failDelete.add(key);
    const res = await api('delete', `/${created.body.id}`);
    expect(res.status).toBe(204);
    expect(await prisma.category.count()).toBe(0);
    // The Upload row survives with attachedAt unset so the cleanup cron retries the delete (T-008).
    const row = await prisma.upload.findUniqueOrThrow({ where: { key } });
    expect(row.attachedAt).toBeNull();
  });

  it('ADM-03 · re-saving with the same image key makes no S3 calls', async () => {
    const key = await presignedKey();
    const created = await api('post', '').send({ ...goodBody('bedroom'), image: { key } });
    expect(created.status).toBe(201);
    resetS3();
    const res = await api('patch', `/${created.body.id}`).send({
      image: { key, alt: { en: 'Bedroom', ar: 'غرفة النوم' } },
      sortOrder: 5,
    });
    expect(res.status).toBe(200);
    expect(res.body.image.alt.en).toBe('Bedroom');
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
  });

  it('ADM-03 · release runs only after commit: a rolled-back save (slug conflict) deletes nothing from R2', async () => {
    await api('post', '').send(goodBody('taken')).expect(201);
    const key1 = await presignedKey();
    const victim = await api('post', '').send({ ...goodBody('victim'), image: { key: key1 } });
    expect(victim.status).toBe(201);

    // Patch that attaches a new image AND hits the unique-slug conflict: the transaction rolls back.
    const key2 = await presignedKey();
    const res = await api('patch', `/${victim.body.id}`).send({
      slug: 'taken',
      image: { key: key2 },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
    // Nothing deleted: the old image object and row are intact, the new upload is unattached again.
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
    expect(s3State.objects.has(key1)).toBe(true);
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: key1 } })).attachedAt,
    ).toBeInstanceOf(Date);
    expect((await prisma.upload.findUniqueOrThrow({ where: { key: key2 } })).attachedAt).toBeNull();
    const db = await prisma.category.findUniqueOrThrow({ where: { id: victim.body.id } });
    expect(db.slug).toBe('victim');
    expect(db.image?.key).toBe(key1);
  });
});
