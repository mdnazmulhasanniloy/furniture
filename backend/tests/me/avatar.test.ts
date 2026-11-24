import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_me_avatar_t028',
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
import { AVATAR_PRESIGN_LIMIT } from '../../src/modules/me/service.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { callsOf, presignerModule, resetS3, s3State } from '../helpers/s3Mock.js';

const app = createApp();
let hash = '';

const mkUser = (email: string, over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Reem',
      lastName: 'Nasser',
      email,
      passwordHash: hash,
      isVerified: true,
      ...over,
    },
  });

const presign = (token: string | undefined, body: unknown) => {
  const r = request(app)
    .post('/api/v1/me/avatar/presign')
    .send(body as object);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const patch = (token: string | undefined, body: unknown) => {
  const r = request(app)
    .patch('/api/v1/me')
    .send(body as object);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const good = { contentType: 'image/webp', size: 102400 };
const KEY_RE = /^furnixa\/test\/avatars\/[a-f0-9]{24}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne!');
});
beforeEach(async () => {
  resetS3();
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('PROF-01 · avatar presign', () => {
  it('PROF-01 · presign returns {uploadUrl, key, publicUrl, expiresIn: 300}', async () => {
    const u = await mkUser('a@example.com');
    const res = await presign(signAccessToken(u), good);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresIn', 'key', 'publicUrl', 'uploadUrl']);
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.key).toContain(`/avatars/${u.id}/`);
    expect(res.body.publicUrl).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${res.body.key}`);
  });

  it('PROF-01 · presign rejects svg and gif with 422 UPLOAD_NOT_ALLOWED', async () => {
    const t = signAccessToken(await mkUser('b@example.com'));
    for (const ct of ['image/svg+xml', 'image/gif', 'application/octet-stream']) {
      const res = await presign(t, { contentType: ct, size: 1000 });
      expect(res.status, ct).toBe(422);
      expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
    }
  });

  it('PROF-01 · presign accepts size exactly 2 097 152; rejects 2 097 153', async () => {
    const t = signAccessToken(await mkUser('c@example.com'));
    expect((await presign(t, { contentType: 'image/jpeg', size: 2_097_152 })).status).toBe(200);
    const over = await presign(t, { contentType: 'image/jpeg', size: 2_097_153 });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('PROF-01 · presign key matches furnixa/{env}/avatars/{userId}/{uuid}.{ext}', async () => {
    const u = await mkUser('d@example.com');
    const res = await presign(signAccessToken(u), { contentType: 'image/png', size: 500 });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.key).toContain(`avatars/${u.id}/`);
  });

  it('PROF-01 · presign creates an Upload row with scope avatar and uploadedById = user', async () => {
    const u = await mkUser('e@example.com');
    const res = await presign(signAccessToken(u), good);
    expect(res.status).toBe(200);
    const row = await prisma.upload.findUnique({ where: { key: res.body.key } });
    expect(row).not.toBeNull();
    expect(row!.scope).toBe('avatar');
    expect(row!.uploadedById).toBe(u.id);
    expect(row!.attachedAt).toBeNull();
  });

  it('PROF-01 · presign requires authentication — 401 without token', async () => {
    const res = await presign(undefined, good);
    expect(res.status).toBe(401);
    expect(presignerModule.getSignedUrl).not.toHaveBeenCalled();
    expect(await prisma.upload.count()).toBe(0);
  });

  it('PROF-01 · presign rate limit: 6th presign in 15 min returns 429 with Retry-After', async () => {
    const u = await mkUser('f@example.com');
    const t = signAccessToken(u);
    for (let i = 0; i < AVATAR_PRESIGN_LIMIT; i++) {
      expect((await presign(t, good)).status).toBe(200);
    }
    const res = await presign(t, good);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();
    // Another user is not affected.
    const u2 = await mkUser('f2@example.com');
    expect((await presign(signAccessToken(u2), good)).status).toBe(200);
  });

  it('PROF-01 · an admin can set their own avatar through the same presign endpoint', async () => {
    const admin = await mkUser('admin@example.com', { role: 'ADMIN' });
    const res = await presign(signAccessToken(admin), good);
    expect(res.status).toBe(200);
    expect(res.body.key).toContain(`avatars/${admin.id}/`);
    const row = await prisma.upload.findUnique({ where: { key: res.body.key } });
    expect(row!.scope).toBe('avatar');
    expect(row!.uploadedById).toBe(admin.id);
  });
});

describe('PROF-01 · PATCH /me avatar', () => {
  async function setupAndPresign(email: string) {
    const u = await mkUser(email);
    const presignRes = await presign(signAccessToken(u), good);
    expect(presignRes.status).toBe(200);
    const key = presignRes.body.key as string;
    // Simulate the browser upload: register the object in the mock store.
    s3State.objects.set(key, { ContentType: good.contentType, ContentLength: good.size });
    return { u, key };
  }

  it('PROF-01 · PATCH /me with a valid avatar key attaches it and returns user with avatarUrl', async () => {
    const { u, key } = await setupAndPresign('g@example.com');
    const res = await patch(signAccessToken(u), { avatar: key });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${key}`);
    expect(res.body).not.toHaveProperty('avatar');
    const db = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(db.avatar).toBe(key);
    const row = await prisma.upload.findUnique({ where: { key } });
    expect(row!.attachedAt).toBeInstanceOf(Date);
  });

  it('PROF-01 · PATCH /me with avatar null removes avatar and releases the old key', async () => {
    const { u, key } = await setupAndPresign('h@example.com');
    // Attach the avatar first.
    await patch(signAccessToken(u), { avatar: key }).expect(200);
    resetS3();
    s3State.objects.set(key, { ContentType: good.contentType, ContentLength: good.size });
    const res = await patch(signAccessToken(u), { avatar: null });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toBeNull();
    expect(s3State.deleted).toContain(key);
    expect(await prisma.upload.findUnique({ where: { key } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).avatar).toBeNull();
  });

  it('PROF-01 · PATCH /me replacing avatar releases the old key after the transaction commits', async () => {
    const { u, key: key1 } = await setupAndPresign('i@example.com');
    await patch(signAccessToken(u), { avatar: key1 }).expect(200);
    // Presign a second avatar.
    const p2 = await presign(signAccessToken(u), { contentType: 'image/png', size: 500 });
    expect(p2.status).toBe(200);
    const key2 = p2.body.key as string;
    s3State.objects.set(key2, { ContentType: 'image/png', ContentLength: 500 });
    resetS3();
    s3State.objects.set(key1, { ContentType: good.contentType, ContentLength: good.size });
    s3State.objects.set(key2, { ContentType: 'image/png', ContentLength: 500 });
    const res = await patch(signAccessToken(u), { avatar: key2 });
    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toContain(key2);
    // Old key was released (outside Vercel the release completes before the response).
    expect(s3State.deleted).toContain(key1);
    expect(await prisma.upload.findUnique({ where: { key: key1 } })).toBeNull();
    // New key is attached.
    expect((await prisma.upload.findUnique({ where: { key: key2 } }))!.attachedAt).toBeInstanceOf(
      Date,
    );
  });

  it('PROF-01 · re-saving the same avatar key makes no S3 calls', async () => {
    const { u, key } = await setupAndPresign('j@example.com');
    await patch(signAccessToken(u), { avatar: key }).expect(200);
    resetS3();
    // Re-save with the same key (e.g. user submits the form again without changing avatar).
    const res = await patch(signAccessToken(u), { avatar: key });
    expect(res.status).toBe(200);
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
  });

  it("PROF-01 · PATCH /me with another user's avatar key returns 422 UPLOAD_NOT_ALLOWED", async () => {
    const { key } = await setupAndPresign('k@example.com');
    const other = await mkUser('k2@example.com');
    const res = await patch(signAccessToken(other), { avatar: key });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
    // The original owner's upload row is untouched.
    expect((await prisma.upload.findUnique({ where: { key } }))!.attachedAt).toBeNull();
  });

  it('PROF-01 · PATCH /me with an admin-scope key used as avatar returns 422 UPLOAD_NOT_ALLOWED', async () => {
    const u = await mkUser('l@example.com');
    // Create a fake admin-scoped upload row for the same user.
    const adminKey = `furnixa/test/2026/11/aaaabbbb-0000-1111-2222-333344445555.webp`;
    await prisma.upload.create({
      data: {
        key: adminKey,
        uploadedById: u.id,
        contentType: 'image/webp',
        size: 1000,
        scope: 'admin',
      },
    });
    s3State.objects.set(adminKey, { ContentType: 'image/webp', ContentLength: 1000 });
    const res = await patch(signAccessToken(u), { avatar: adminKey });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('PROF-01 · a full URL as avatar returns 422 UPLOAD_NOT_ALLOWED', async () => {
    const u = await mkUser('m@example.com');
    const res = await patch(signAccessToken(u), { avatar: 'https://cdn.example.com/avatar.webp' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
  });

  it("PROF-01 · a key under the user's own avatar prefix with no Upload row returns 422", async () => {
    const u = await mkUser('n@example.com');
    const fakeKey = `furnixa/test/avatars/${u.id}/00000000-0000-0000-0000-000000000000.webp`;
    s3State.objects.set(fakeKey, { ContentType: 'image/webp', ContentLength: 1000 });
    const res = await patch(signAccessToken(u), { avatar: fakeKey });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it('PROF-01 · transaction rollback does not delete the R2 object', async () => {
    // We simulate a rollback by using a key that is valid but whose Upload row is scoped admin
    // (so syncImages.attachUploads throws inside the transaction).
    const u = await mkUser('o@example.com');
    const badKey = `furnixa/test/2026/11/ccccdddd-0000-1111-2222-333344445555.png`;
    await prisma.upload.create({
      data: {
        key: badKey,
        uploadedById: u.id,
        contentType: 'image/png',
        size: 2000,
        scope: 'admin',
      },
    });
    s3State.objects.set(badKey, { ContentType: 'image/png', ContentLength: 2000 });
    const res = await patch(signAccessToken(u), { avatar: badKey });
    expect(res.status).toBe(422);
    // No DeleteObjectCommand was sent — the transaction rolled back.
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
    expect(s3State.objects.has(badKey)).toBe(true);
  });

  it('PROF-01 · avatar and other profile fields can be updated in one call', async () => {
    const { u, key } = await setupAndPresign('p@example.com');
    const res = await patch(signAccessToken(u), { avatar: key, firstName: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.firstName).toBe('Updated');
    expect(res.body.avatarUrl).toContain(key);
    const db = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(db.firstName).toBe('Updated');
    expect(db.avatar).toBe(key);
  });
});
