import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cron_cleanup_t025',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);

import { ObjectId } from 'mongodb';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { createLogger, REDACT_CENSOR } from '../../src/lib/logger.js';
import { adapterCollection, closeMongoClient, getMongoClient } from '../../src/lib/mongo.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { UPLOADS_PER_RUN } from '../../src/modules/cron/service.js';
import { callsOf, resetS3, s3State } from '../helpers/s3Mock.js';

const SECRET = 'test-cron-secret-0123456789abcdefghij';
const app = createApp({ env: { ...getEnv(), CRON_SECRET: SECRET } });

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);
const inFuture = (ms: number) => new Date(Date.now() + ms);
const RESULT_KEYS = ['notifications', 'otps', 'refreshTokens', 'socketEvents', 'uploads'];

const run = (a = app) =>
  request(a).get('/internal/cron/cleanup').set('Authorization', `Bearer ${SECRET}`);

let userId = '';
const mkKey = () => `furnixa/test/2026/01/${randomUUID()}.png`;
const mkUpload = (createdAt: Date, attachedAt: Date | null = null, key = mkKey()) =>
  prisma.upload.create({
    data: {
      key,
      uploadedById: userId,
      contentType: 'image/png',
      size: 1000,
      scope: 'admin',
      createdAt,
      attachedAt,
    },
  });
const mkNotification = (createdAt: Date, readAt: Date | null) =>
  prisma.notification.create({
    data: {
      userId,
      type: 'SYSTEM',
      title: { en: 't', ar: 'ع' },
      body: { en: 'b', ar: 'ن' },
      link: null,
      readAt,
      createdAt,
    },
  });
/** Rule-8 regression seed: a document whose optional field is MISSING, not null. */
const rawInsert = (collection: string, doc: Record<string, unknown>) =>
  getMongoClient().db().collection(collection).insertOne(doc);

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, stream);
  return { logger, text: () => lines.join(''), entries: () => lines.map((l) => JSON.parse(l)) };
}
const settle = () => new Promise((r) => setTimeout(r, 50)); // pino-http logs on response finish

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  resetS3();
  await prisma.otp.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await adapterCollection().deleteMany({});
  userId = (
    await prisma.user.create({
      data: {
        firstName: 'C',
        lastName: 'Ron',
        email: 'cron@example.com',
        passwordHash: await hashPassword('Passw0rdOne!'),
        isVerified: true,
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.otp.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await adapterCollection().deleteMany({});
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('NFR-01 · cron secret handling', () => {
  it('NFR-01 · Bearer CRON_SECRET on GET returns the full counts shape', async () => {
    const res = await run();
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(RESULT_KEYS);
    for (const k of RESULT_KEYS) expect(res.body[k]).toBe(0);
  });

  it('NFR-01 · x-cron-secret on POST returns the full counts shape', async () => {
    const res = await request(app).post('/internal/cron/cleanup').set('x-cron-secret', SECRET);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(RESULT_KEYS);
  });

  it('NFR-01 · missing, wrong and wrong-length secrets get 401 with the Error schema', async () => {
    for (const r of [
      request(app).get('/internal/cron/cleanup'),
      request(app)
        .get('/internal/cron/cleanup')
        .set('Authorization', `Bearer ${'x'.repeat(36)}`),
      request(app).get('/internal/cron/cleanup').set('x-cron-secret', 'short'),
      request(app).post('/internal/cron/cleanup').set('Authorization', 'Bearer '),
    ]) {
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(typeof res.body.message).toBe('string');
      expect(typeof res.body.requestId).toBe('string');
    }
  });

  it('NFR-01 · a valid user access token is rejected', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const res = await request(app)
      .get('/internal/cron/cleanup')
      .set('Authorization', `Bearer ${signAccessToken(user)}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('NFR-01 · the route is not mounted when CRON_SECRET is unset', async () => {
    const bare = createApp({ env: { ...getEnv(), CRON_SECRET: undefined } });
    expect((await run(bare)).status).toBe(404);
    expect(
      (await request(bare).post('/internal/cron/cleanup').set('x-cron-secret', SECRET)).status,
    ).toBe(404);
  });

  it('NFR-01 · the request log never contains CRON_SECRET (either header form)', async () => {
    const { logger, text, entries } = capture();
    const logged = createApp({ env: { ...getEnv(), CRON_SECRET: SECRET }, logger });
    await request(logged)
      .get('/internal/cron/cleanup')
      .set('X-Request-Id', 'req-cron-1')
      .set('Authorization', `Bearer ${SECRET}`);
    await request(logged)
      .post('/internal/cron/cleanup')
      .set('X-Request-Id', 'req-cron-2')
      .set('x-cron-secret', SECRET);
    await settle();

    const out = text();
    expect(out, 'leaked CRON_SECRET').not.toContain(SECRET);
    expect(out).toContain('req-cron-1');
    expect(out).toContain('req-cron-2');
    // the redaction really ran on the serialized headers (not merely absent)
    const withHeader = entries().find((e) => e.req?.headers?.['x-cron-secret']);
    expect(withHeader.req.headers['x-cron-secret']).toBe(REDACT_CENSOR);
    const withBearer = entries().find((e) => e.req?.headers?.authorization);
    expect(withBearer.req.headers.authorization).toBe(REDACT_CENSOR);
  });
});

describe('NFR-08 · cleanup sweeps', () => {
  it('NFR-08 · expired and consumed OTPs go; live ones stay, including a document without a consumedAt field', async () => {
    const otp = (data: { expiresAt: Date; consumedAt: Date | null }) =>
      prisma.otp.create({
        data: { email: 'o@example.com', purpose: 'VERIFY_EMAIL', codeHash: 'h', ...data },
      });
    await otp({ expiresAt: ago(MIN), consumedAt: null }); // expired
    await otp({ expiresAt: inFuture(HOUR), consumedAt: ago(MIN) }); // consumed
    const live = await otp({ expiresAt: inFuture(HOUR), consumedAt: null });
    // Rule 8: stored WITHOUT consumedAt; "consumed" must not match it.
    await rawInsert('Otp', {
      email: 'raw@example.com',
      purpose: 'VERIFY_EMAIL',
      codeHash: 'h',
      attempts: 0,
      expiresAt: inFuture(HOUR),
      createdAt: new Date(),
    });

    const res = await run();
    expect(res.status).toBe(200);
    expect(res.body.otps).toBe(2);
    expect(await prisma.otp.count()).toBe(2);
    expect(await prisma.otp.findUnique({ where: { id: live.id } })).not.toBeNull();
    expect(await prisma.otp.count({ where: { email: 'raw@example.com' } })).toBe(1);
  });

  it('NFR-08 · expired and revoked refresh tokens go; live ones stay', async () => {
    const rt = (data: { expiresAt: Date; revokedAt: Date | null }) =>
      prisma.refreshToken.create({
        data: { userId, familyId: randomUUID(), tokenHash: randomUUID(), ...data },
      });
    await rt({ expiresAt: ago(MIN), revokedAt: null });
    await rt({ expiresAt: inFuture(HOUR), revokedAt: ago(MIN) });
    const live = await rt({ expiresAt: inFuture(HOUR), revokedAt: null });

    const res = await run();
    expect(res.body.refreshTokens).toBe(2);
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(await prisma.refreshToken.findUnique({ where: { id: live.id } })).not.toBeNull();
  });

  it('NFR-08 · adapter documents older than SOCKET_ADAPTER_TTL_SECONDS go; newer ones stay', async () => {
    const ttlMs = getEnv().SOCKET_ADAPTER_TTL_SECONDS * 1000;
    await adapterCollection().insertMany([
      { type: 'event', createdAt: ago(ttlMs + MIN) },
      { type: 'event', createdAt: ago(ttlMs + HOUR) },
      { type: 'event', createdAt: ago(MIN) },
    ]);

    const res = await run();
    expect(res.body.socketEvents).toBe(2);
    expect(await adapterCollection().countDocuments({})).toBe(1);
  });

  it('NFR-08 · read notifications older than 90 days and unread ones older than 180 days go, including a document without a readAt field', async () => {
    await mkNotification(ago(91 * DAY), ago(90 * DAY)); // read, old -> goes
    const readRecent = await mkNotification(ago(10 * DAY), ago(DAY)); // read, recent -> stays
    await mkNotification(ago(181 * DAY), null); // unread (explicit null), old -> goes
    const unreadRecent = await mkNotification(ago(10 * DAY), null); // unread, recent -> stays
    // Rule 8: stored WITHOUT readAt. The old one must go via the unread branch; the 100-day one
    // must stay (it is unread, so the 90-day read rule must not match a missing field).
    const rawDoc = (createdAt: Date) => ({
      userId: new ObjectId(userId),
      type: 'SYSTEM',
      title: { en: 't', ar: 'ع' },
      body: { en: 'b', ar: 'ن' },
      createdAt,
    });
    await rawInsert('Notification', rawDoc(ago(181 * DAY)));
    const kept = await rawInsert('Notification', rawDoc(ago(100 * DAY)));

    const res = await run();
    expect(res.body.notifications).toBe(3);
    expect(await prisma.notification.count()).toBe(3);
    expect(await prisma.notification.findUnique({ where: { id: readRecent.id } })).not.toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: unreadRecent.id } })).not.toBeNull();
    expect(
      await getMongoClient().db().collection('Notification').countDocuments({
        _id: kept.insertedId,
      }),
    ).toBe(1);
  });

  it('NFR-08 · only unattached uploads older than 24 h go, with their R2 object; a failed R2 delete keeps the row and is not counted', async () => {
    const attached = await mkUpload(ago(2 * DAY), ago(DAY)); // attached -> stays, object untouched
    const young = await mkUpload(ago(2 * HOUR)); // unattached, young -> stays
    const old = await mkUpload(ago(2 * DAY)); // unattached, old -> goes with its object
    const failing = await mkUpload(ago(2 * DAY)); // R2 delete fails -> row kept for the next run
    s3State.failDelete.add(failing.key);

    const res = await run();
    expect(res.body.uploads).toBe(1);
    expect(s3State.deleted).toEqual([old.key]);
    expect(await prisma.upload.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.upload.findUnique({ where: { id: attached.id } })).not.toBeNull();
    expect(await prisma.upload.findUnique({ where: { id: young.id } })).not.toBeNull();
    expect(await prisma.upload.findUnique({ where: { id: failing.id } })).not.toBeNull();
    // the attached and young keys were never sent to R2 delete
    const deletedKeys = callsOf('DeleteObjectCommand').map((c) => c.input.Key);
    expect(deletedKeys.sort()).toEqual([failing.key, old.key].sort());
  });

  it('NFR-08 · an R2 object referenced by an order item imageKey is never deleted; the stale row is still removed', async () => {
    const referenced = await mkUpload(ago(2 * DAY));
    await prisma.order.create({
      data: {
        orderNo: 'FX-20261123-0001',
        userId,
        idempotencyKey: randomUUID(),
        addressId: '0'.repeat(24),
        items: [
          {
            productId: '0'.repeat(24),
            titleSnapshot: { en: 'snap', ar: 'سناب' },
            sku: null,
            imageSnapshot: `${getEnv().R2_PUBLIC_BASE_URL}/${referenced.key}`,
            imageKey: referenced.key,
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

    const res = await run();
    expect(res.body.uploads).toBe(1); // the row is detached (removed)
    expect(await prisma.upload.count()).toBe(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0); // the object is never deleted
    expect(s3State.deleted).toEqual([]);
  });

  it(`NFR-08 · at most ${UPLOADS_PER_RUN} uploads per run, oldest first; the next run takes the rest`, async () => {
    const total = UPLOADS_PER_RUN + 5;
    await prisma.upload.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        key: mkKey(),
        uploadedById: userId,
        contentType: 'image/png',
        size: 1000,
        scope: 'admin',
        createdAt: ago(2 * DAY + i * MIN),
        attachedAt: null,
      })),
    });

    const first = await run();
    expect(first.body.uploads).toBe(UPLOADS_PER_RUN);
    expect(await prisma.upload.count()).toBe(5);
    const second = await run();
    expect(second.body.uploads).toBe(5);
    expect(await prisma.upload.count()).toBe(0);
  });

  it('NFR-08 · running twice is safe: the second run removes nothing and keeps the kept rows', async () => {
    await prisma.otp.create({
      data: {
        email: 'o@example.com',
        purpose: 'VERIFY_EMAIL',
        codeHash: 'h',
        expiresAt: ago(MIN),
        consumedAt: null,
      },
    });
    await prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: randomUUID(),
        expiresAt: inFuture(HOUR),
        revokedAt: ago(MIN),
      },
    });
    await mkNotification(ago(91 * DAY), ago(90 * DAY));
    const keptNotification = await mkNotification(ago(DAY), null);
    await mkUpload(ago(2 * DAY));
    await adapterCollection().insertOne({
      type: 'event',
      createdAt: ago(getEnv().SOCKET_ADAPTER_TTL_SECONDS * 1000 + MIN),
    });

    const first = await run();
    expect(first.body).toEqual({
      otps: 1,
      refreshTokens: 1,
      socketEvents: 1,
      uploads: 1,
      notifications: 1,
    });

    const second = await run();
    expect(second.status).toBe(200);
    expect(second.body).toEqual({
      otps: 0,
      refreshTokens: 0,
      socketEvents: 0,
      uploads: 0,
      notifications: 0,
    });
    expect(
      await prisma.notification.findUnique({ where: { id: keptNotification.id } }),
    ).not.toBeNull();
  });
});
