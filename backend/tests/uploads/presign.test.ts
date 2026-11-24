import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_uploads_presign_t008',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { createLogger } from '../../src/lib/logger.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { presignerModule, resetS3, s3State, SIGNATURE } from '../helpers/s3Mock.js';

const app = createApp();
let hash = '';
const mkUser = (email: string, role: 'ADMIN' | 'CUSTOMER' = 'ADMIN') =>
  prisma.user.create({
    data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true, role },
  });
const post = (token: string | undefined, body: unknown, a = app) => {
  const r = request(a)
    .post('/api/v1/admin/uploads/presign')
    .send(body as object);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const good = { fileName: 'sofa.png', contentType: 'image/png', size: 1000 };
const KEY_RE = /^furnixa\/test\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

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

describe('ADM-02 · POST /admin/uploads/presign', () => {
  it('ADM-02 · an admin gets {uploadUrl, key, publicUrl, expiresIn: 300}', async () => {
    const t = signAccessToken(await mkUser('a@example.com'));
    const res = await post(t, good);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['expiresIn', 'key', 'publicUrl', 'uploadUrl']);
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.publicUrl).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${res.body.key}`);
    expect(res.body.uploadUrl).toContain(res.body.key);
  });

  it('ADM-02 · a customer gets 403 and no token gets 401; nothing is signed or recorded', async () => {
    const c = signAccessToken(await mkUser('c@example.com', 'CUSTOMER'));
    expect((await post(c, good)).status).toBe(403);
    expect((await post(undefined, good)).status).toBe(401);
    expect(presignerModule.getSignedUrl).not.toHaveBeenCalled();
    expect(await prisma.upload.count()).toBe(0);
  });

  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ])('ADM-02 · accepts %s and uses the .%s extension', async (contentType, ext) => {
    const t = signAccessToken(await mkUser('t@example.com'));
    const res = await post(t, { ...good, contentType });
    expect(res.status).toBe(200);
    expect(res.body.key.endsWith(`.${ext}`)).toBe(true);
  });

  it.each(['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', 'IMAGE/PNG'])(
    'ADM-02 · rejects content type %s with 422 UPLOAD_NOT_ALLOWED (SVG is never allowed)',
    async (contentType) => {
      const t = signAccessToken(await mkUser('r@example.com'));
      const res = await post(t, { ...good, contentType });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
      expect(presignerModule.getSignedUrl).not.toHaveBeenCalled();
      expect(await prisma.upload.count()).toBe(0);
    },
  );

  it('ADM-02 · 5 242 880 bytes is accepted, 5 242 881 is 422 UPLOAD_NOT_ALLOWED', async () => {
    const t = signAccessToken(await mkUser('s@example.com'));
    expect((await post(t, { ...good, size: 5_242_880 })).status).toBe(200);
    const over = await post(t, { ...good, size: 5_242_881 });
    expect(over.status).toBe(422);
    expect(over.body.code).toBe('UPLOAD_NOT_ALLOWED');
  });

  it.each([
    [{ ...good, size: 0 }],
    [{ ...good, size: 1.5 }],
    [{ ...good, size: '1000' }],
    [{ ...good, fileName: '' }],
    [{ contentType: 'image/png', size: 10 }],
    [{ ...good, extra: 1 }],
  ])('ADM-02 · a malformed body %j is 422 VALIDATION_ERROR', async (body) => {
    const t = signAccessToken(await mkUser('m@example.com'));
    const res = await post(t, body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('ADM-02 · the key ignores fileName entirely', async () => {
    const t = signAccessToken(await mkUser('k@example.com'));
    const res = await post(t, { ...good, fileName: '../../evil.svg' });
    expect(res.status).toBe(200);
    expect(res.body.key).toMatch(KEY_RE);
    expect(res.body.key).not.toContain('evil');
    expect(JSON.stringify(s3State.calls)).not.toContain('evil');
  });

  it('ADM-02 · the presigner is called with bucket, key, ContentType, ContentLength and expiresIn 300', async () => {
    const t = signAccessToken(await mkUser('p@example.com'));
    const res = await post(t, { ...good, contentType: 'image/webp', size: 4321 });
    expect(presignerModule.getSignedUrl).toHaveBeenCalledTimes(1);
    const [, cmd, opts] = presignerModule.getSignedUrl.mock.calls[0]!;
    expect(cmd.input).toEqual({
      Bucket: getEnv().R2_BUCKET_NAME,
      Key: res.body.key,
      ContentType: 'image/webp',
      ContentLength: 4321,
    });
    expect(opts).toEqual({ expiresIn: 300 });
    expect(s3State.clientConfigs[0]).toMatchObject({
      region: 'auto',
      endpoint: getEnv().R2_ENDPOINT,
      requestChecksumCalculation: 'WHEN_REQUIRED',
    });
  });

  it('ADM-02 · presign records an Upload row (scope admin, unattached)', async () => {
    const admin = await mkUser('u@example.com');
    const res = await post(signAccessToken(admin), {
      ...good,
      contentType: 'image/jpeg',
      size: 77,
    });
    const row = await prisma.upload.findUniqueOrThrow({ where: { key: res.body.key } });
    expect(row).toMatchObject({
      uploadedById: admin.id,
      contentType: 'image/jpeg',
      size: 77,
      scope: 'admin',
      attachedAt: null,
    });
  });

  it('ADM-02 · the 31st presign in 10 minutes is 429 RATE_LIMITED with Retry-After; another admin is unaffected', async () => {
    const a = signAccessToken(await mkUser('l1@example.com'));
    const b = signAccessToken(await mkUser('l2@example.com'));
    for (let i = 0; i < 30; i++) expect((await post(a, good)).status).toBe(200);
    const res = await post(a, good);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(await prisma.upload.count()).toBe(30);
    expect((await post(b, good)).status).toBe(200);
  });

  it('ADM-02 · rejected presign requests count towards the limit', async () => {
    const a = signAccessToken(await mkUser('l3@example.com'));
    for (let i = 0; i < 30; i++) {
      expect((await post(a, { ...good, contentType: 'image/svg+xml' })).status).toBe(422);
    }
    expect((await post(a, good)).status).toBe(429);
  });

  it('ADM-02 · the presign window resets after 10 minutes', async () => {
    const a = signAccessToken(await mkUser('l4@example.com'));
    for (let i = 0; i < 31; i++) await post(a, good);
    expect((await post(a, good)).status).toBe(429);
    await prisma.rateLimit.updateMany({ data: { resetAt: new Date(Date.now() - 1000) } });
    expect((await post(a, good)).status).toBe(200);
  });

  it('ADM-02 · logs and error responses never contain the presigned URL, its signature or R2 credentials', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'debug' }, stream);
    const logged = createApp({ logger });
    const t = signAccessToken(await mkUser('log@example.com'));
    const ok = await post(t, good, logged);
    expect(ok.status).toBe(200);
    const bad = await post(t, { ...good, contentType: 'image/svg+xml' }, logged);
    // an unexpected failure in the signer must not leak either
    presignerModule.getSignedUrl.mockRejectedValueOnce(new Error('signer exploded'));
    const broken = await post(t, good, logged);
    expect(broken.status).toBe(500);
    await new Promise((r) => setTimeout(r, 50));

    const env = getEnv();
    const everything = lines.join('') + JSON.stringify(bad.body) + JSON.stringify(broken.body);
    expect(lines.length).toBeGreaterThan(0);
    for (const secret of [
      ok.body.uploadUrl as string,
      SIGNATURE,
      'X-Amz-Signature',
      env.R2_ACCESS_KEY_ID!,
      env.R2_SECRET_ACCESS_KEY!,
    ]) {
      expect(everything).not.toContain(secret);
    }

    // and the redaction list itself covers a logged uploadUrl
    const probe: string[] = [];
    createLogger(
      { NODE_ENV: 'development', LOG_LEVEL: 'info' },
      new Writable({
        write(c: Buffer, _e, cb) {
          probe.push(c.toString());
          cb();
        },
      }),
    ).info({ uploadUrl: ok.body.uploadUrl, res: { uploadUrl: ok.body.uploadUrl } }, 'probe');
    expect(probe.join('')).not.toContain(SIGNATURE);
    expect(probe.join('')).toContain('[REDACTED]');
  });
});
