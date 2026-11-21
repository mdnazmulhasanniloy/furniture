import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_uploads_helpers_t008',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);

import { getEnv } from '../../src/config/env.js';
import { AppError } from '../../src/lib/errors.js';
import { createLogger } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  attachUploads,
  buildImageAsset,
  deleteObjects,
  releaseUploads,
  syncImages,
  type UploadScope,
} from '../../src/lib/r2.js';
import { callsOf, resetS3, s3State, SIGNATURE } from '../helpers/s3Mock.js';

const P = 'furnixa/test/2026/11/';
const OWNER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';
let n = 0;
const newKey = () => `${P}${String(++n).padStart(8, '0')}-0000-4000-8000-000000000000.png`;

/** A tracked upload whose object exists in the (mocked) bucket. */
async function seed(
  over: {
    key?: string;
    scope?: UploadScope;
    uploadedById?: string;
    attached?: boolean;
    object?: boolean | { ContentType?: string; ContentLength?: number };
    size?: number;
  } = {},
) {
  const key = over.key ?? newKey();
  const size = over.size ?? 1234;
  await prisma.upload.create({
    data: {
      key,
      uploadedById: over.uploadedById ?? OWNER,
      contentType: 'image/png',
      size,
      scope: over.scope ?? 'admin',
      attachedAt: over.attached ? new Date() : null,
    },
  });
  const object = over.object ?? true;
  if (object) {
    s3State.objects.set(
      key,
      object === true ? { ContentType: 'image/png', ContentLength: size } : object,
    );
  }
  return key;
}
const attachedAt = async (key: string) =>
  (await prisma.upload.findUniqueOrThrow({ where: { key } })).attachedAt;
const rejects = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).status).toBe(422);
  expect((err as AppError).code).toBe('UPLOAD_NOT_ALLOWED');
};

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  resetS3();
  await prisma.upload.deleteMany();
});
afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-02 · buildImageAsset', () => {
  it('ADM-02 · recomputes url from key (R2_PUBLIC_BASE_URL + "/" + key) and keeps optional fields', () => {
    const key = newKey();
    expect(buildImageAsset(key)).toEqual({ key, url: `${getEnv().R2_PUBLIC_BASE_URL}/${key}` });
    const alt = { en: 'Sofa', ar: 'أريكة' };
    expect(buildImageAsset(key, { width: 10, height: 20, alt })).toEqual({
      key,
      url: `${getEnv().R2_PUBLIC_BASE_URL}/${key}`,
      width: 10,
      height: 20,
      alt,
    });
  });

  it.each([
    ['a foreign prefix', 'uploads/2026/11/x.png'],
    ['another environment', 'furnixa/production/2026/11/x.png'],
    ['the bare env prefix of a sibling', 'furnixa/testing/2026/11/x.png'],
    ['path traversal', `${P}../../secret.png`],
    ['a double slash', `${P}/x.png`],
    ['an svg extension', `${P}x.svg`],
    ['no extension', `${P}x`],
    ['a query string', `${P}x.png?a=b`],
    ['whitespace', `${P}x y.png`],
    ['a backslash', `${P}x\\y.png`],
    ['an overlong key', `${P}${'a'.repeat(300)}.png`],
  ])('ADM-02 · rejects a key with %s (422 UPLOAD_NOT_ALLOWED)', (_n, key) => {
    try {
      buildImageAsset(key);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(422);
      expect((e as AppError).code).toBe('UPLOAD_NOT_ALLOWED');
    }
  });

  it('ADM-02 · rejects a non-string key', () => {
    expect(() => buildImageAsset(undefined as unknown as string)).toThrow(AppError);
  });
});

describe('ADM-02 · attachUploads', () => {
  it('ADM-02 · a row whose attachedAt field is MISSING (not null) can still be claimed', async () => {
    // A writer that omits attachedAt leaves the field missing in MongoDB, and a `{ attachedAt: null }`
    // filter does not match it (found in T-028: presign-created avatars could never be attached).
    const key = newKey();
    await prisma.upload.create({
      data: { key, uploadedById: OWNER, contentType: 'image/png', size: 1234, scope: 'admin' },
    });
    const raw = await prisma.upload.findRaw({
      filter: { key, attachedAt: { $exists: false } },
    });
    expect(raw).toHaveLength(1); // precondition: the field really is missing
    s3State.objects.set(key, { ContentType: 'image/png', ContentLength: 1234 });
    await attachUploads([key], { scope: 'admin', uploadedById: OWNER });
    expect(await attachedAt(key)).toBeInstanceOf(Date);
  });

  it('ADM-02 · attaches tracked uploads after a HeadObject check', async () => {
    const a = await seed();
    const b = await seed();
    await attachUploads([a, b], { scope: 'admin', uploadedById: OWNER });
    expect(await attachedAt(a)).toBeInstanceOf(Date);
    expect(await attachedAt(b)).toBeInstanceOf(Date);
    expect(
      callsOf('HeadObjectCommand')
        .map((c) => c.input.Key)
        .sort(),
    ).toEqual([a, b].sort());
    expect(callsOf('HeadObjectCommand')[0]!.input.Bucket).toBe(getEnv().R2_BUCKET_NAME);
  });

  it('ADM-02 · no keys means no work and no S3 calls', async () => {
    await attachUploads([], { scope: 'admin', uploadedById: OWNER });
    expect(s3State.calls).toEqual([]);
  });

  it('ADM-02 · a missing object is rejected (422) and nothing is attached', async () => {
    const k = await seed({ object: false });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
    expect(await attachedAt(k)).toBeNull();
  });

  it('ADM-02 · a ContentType that differs from the Upload row is rejected', async () => {
    const k = await seed({ object: { ContentType: 'image/jpeg', ContentLength: 1234 } });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
    expect(await attachedAt(k)).toBeNull();
  });

  it('ADM-02 · a size that differs from the Upload row is rejected', async () => {
    const k = await seed({ object: { ContentType: 'image/png', ContentLength: 9999 } });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
    expect(await attachedAt(k)).toBeNull();
  });

  it('ADM-02 · a key with no Upload row is rejected without calling S3', async () => {
    const k = newKey();
    s3State.objects.set(k, { ContentType: 'image/png', ContentLength: 1 });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
    expect(s3State.calls).toEqual([]);
  });

  it('ADM-02 · an invalid key (foreign prefix) is rejected before any lookup', async () => {
    await rejects(attachUploads(['evil/x.png'], { scope: 'admin', uploadedById: OWNER }));
    expect(s3State.calls).toEqual([]);
  });

  it('ADM-02 · an already attached key is rejected', async () => {
    const k = await seed({ attached: true });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
  });

  it('ADM-02 · one bad key attaches none (all or nothing)', async () => {
    const good1 = await seed();
    const good2 = await seed();
    const bad = await seed({ object: false });
    await rejects(attachUploads([good1, bad, good2], { scope: 'admin', uploadedById: OWNER }));
    expect(await attachedAt(good1)).toBeNull();
    expect(await attachedAt(good2)).toBeNull();
  });

  it('ADM-02 · a concurrent claim of the same key fails for the loser and attaches once', async () => {
    const k = await seed();
    const results = await Promise.allSettled([
      attachUploads([k], { scope: 'admin', uploadedById: OWNER }),
      attachUploads([k], { scope: 'admin', uploadedById: OWNER }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(await attachedAt(k)).toBeInstanceOf(Date);
  });

  it('ADM-02 · any admin may attach an admin upload made by another admin', async () => {
    const k = await seed({ scope: 'admin', uploadedById: OWNER });
    await attachUploads([k], { scope: 'admin', uploadedById: OTHER });
    expect(await attachedAt(k)).toBeInstanceOf(Date);
  });

  it('ADM-02 · an avatar upload cannot be attached as an admin image (product, banner, category)', async () => {
    const k = await seed({ scope: 'avatar', uploadedById: OWNER });
    await rejects(attachUploads([k], { scope: 'admin', uploadedById: OWNER }));
    expect(await attachedAt(k)).toBeNull();
  });

  it('ADM-02 · an admin upload cannot be attached as an avatar', async () => {
    const k = await seed({ scope: 'admin', uploadedById: OWNER });
    await rejects(attachUploads([k], { scope: 'avatar', uploadedById: OWNER }));
    expect(await attachedAt(k)).toBeNull();
  });

  it("ADM-02 · an avatar upload of another user is rejected; the owner's is accepted", async () => {
    const k = await seed({ scope: 'avatar', uploadedById: OWNER });
    await rejects(attachUploads([k], { scope: 'avatar', uploadedById: OTHER }));
    expect(await attachedAt(k)).toBeNull();
    await attachUploads([k], { scope: 'avatar', uploadedById: OWNER });
    expect(await attachedAt(k)).toBeInstanceOf(Date);
  });

  it('ADM-02 · uses the passed transaction: a rollback leaves the upload unattached', async () => {
    const k = await seed();
    await expect(
      prisma.$transaction(async (tx) => {
        await attachUploads([k], { scope: 'admin', uploadedById: OWNER, tx });
        throw new Error('caller failed after attaching');
      }),
    ).rejects.toThrow('caller failed');
    expect(await attachedAt(k)).toBeNull();
    await prisma.$transaction((tx) =>
      attachUploads([k], { scope: 'admin', uploadedById: OWNER, tx }),
    );
    expect(await attachedAt(k)).toBeInstanceOf(Date);
  });

  it('ADM-02 · a HeadObject failure other than "not found" is logged and rethrown (500), nothing attached', async () => {
    const k = await seed();
    s3State.headError = new Error('R2 timeout');
    const log = { error: vi.fn() };
    await expect(
      attachUploads([k], { scope: 'admin', uploadedById: OWNER, log, requestId: 'req-1' }),
    ).rejects.toThrow('R2 timeout');
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: k, requestId: 'req-1' }),
      expect.any(String),
    );
    expect(await attachedAt(k)).toBeNull();
  });
});

describe('ADM-02 · deleteObjects and releaseUploads', () => {
  it('ADM-02 · releaseUploads deletes every object and its row', async () => {
    const a = await seed({ attached: true });
    const b = await seed({ attached: true });
    await releaseUploads([a, b]);
    expect(s3State.deleted.sort()).toEqual([a, b].sort());
    expect(callsOf('DeleteObjectCommand')[0]!.input.Bucket).toBe(getEnv().R2_BUCKET_NAME);
    expect(await prisma.upload.count()).toBe(0);
  });

  it('ADM-02 · a failing DeleteObject is logged (key, requestId) and does not throw; the row is kept unattached for the cron', async () => {
    const bad = await seed({ attached: true });
    const ok = await seed({ attached: true });
    s3State.failDelete.add(bad);
    const log = { error: vi.fn() };
    await expect(releaseUploads([bad, ok], { log, requestId: 'req-2' })).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ key: bad, requestId: 'req-2' }),
      expect.any(String),
    );
    expect(await prisma.upload.findUnique({ where: { key: ok } })).toBeNull();
    const kept = await prisma.upload.findUniqueOrThrow({ where: { key: bad } });
    expect(kept.attachedAt).toBeNull();
  });

  it('ADM-02 · a key without an Upload row is still deleted from R2', async () => {
    const k = newKey();
    s3State.objects.set(k, { ContentType: 'image/png', ContentLength: 1 });
    await releaseUploads([k]);
    expect(s3State.deleted).toEqual([k]);
  });

  it('ADM-02 · deleteObjects reports deleted and failed keys and never throws', async () => {
    const a = newKey();
    const b = newKey();
    s3State.failDelete.add(b);
    const log = { error: vi.fn() };
    const res = await deleteObjects([a, b, a], { log });
    expect(res).toEqual({ deleted: [a], failed: [b] });
    expect(callsOf('DeleteObjectCommand')).toHaveLength(2); // duplicates collapse
    expect(log.error).toHaveBeenCalledTimes(1);
  });

  it('ADM-02 · the delete-failure log line contains no signature, URL or R2 credential', async () => {
    const lines: string[] = [];
    const logger = createLogger(
      { NODE_ENV: 'development', LOG_LEVEL: 'info' },
      new Writable({
        write(c: Buffer, _e, cb) {
          lines.push(c.toString());
          cb();
        },
      }),
    );
    const k = await seed({ attached: true });
    s3State.failDelete.add(k);
    await releaseUploads([k], { log: logger, requestId: 'req-3' });
    const text = lines.join('');
    expect(text).toContain(k);
    for (const s of [
      SIGNATURE,
      'X-Amz-Signature',
      getEnv().R2_SECRET_ACCESS_KEY!,
      getEnv().R2_ACCESS_KEY_ID!,
    ]) {
      expect(text).not.toContain(s);
    }
  });

  it('ADM-02 · releaseUploads with no keys does nothing', async () => {
    await releaseUploads([]);
    expect(s3State.calls).toEqual([]);
  });
});

describe('ADM-02 · syncImages', () => {
  const run = (oldKeys: string[], newKeys: string[], scope: UploadScope = 'admin') =>
    prisma.$transaction((tx) => syncImages(tx, oldKeys, newKeys, scope, { uploadedById: OWNER }));

  it('ADM-02 · re-saving with the same keys succeeds and makes no S3 calls', async () => {
    const a = await seed({ attached: true });
    const b = await seed({ attached: true });
    const res = await run([a, b], [a, b]);
    await res.release();
    expect(res).toMatchObject({ added: [], removed: [] });
    expect(s3State.calls).toEqual([]);
    expect(await prisma.upload.count()).toBe(2);
  });

  it('ADM-02 · reorder only (same keys, new order) makes no S3 calls', async () => {
    const a = await seed({ attached: true });
    const b = await seed({ attached: true });
    const c = await seed({ attached: true });
    const res = await run([a, b, c], [c, a, b]);
    await res.release();
    expect(res).toMatchObject({ added: [], removed: [] });
    expect(s3State.calls).toEqual([]);
  });

  it('ADM-02 · add one and remove one attaches one and releases one', async () => {
    const keep = await seed({ attached: true });
    const gone = await seed({ attached: true });
    const fresh = await seed();
    const res = await run([keep, gone], [keep, fresh]);
    expect(res.added).toEqual([fresh]);
    expect(res.removed).toEqual([gone]);
    // attached inside the transaction, checked once; nothing deleted until release()
    expect(callsOf('HeadObjectCommand').map((c) => c.input.Key)).toEqual([fresh]);
    expect(await attachedAt(fresh)).toBeInstanceOf(Date);
    expect(callsOf('DeleteObjectCommand')).toEqual([]);
    await res.release();
    expect(callsOf('DeleteObjectCommand').map((c) => c.input.Key)).toEqual([gone]);
    expect(await prisma.upload.findUnique({ where: { key: gone } })).toBeNull();
    expect(await prisma.upload.findUnique({ where: { key: keep } })).not.toBeNull();
  });

  it('ADM-02 · a rejected added key aborts the sync before anything is released', async () => {
    const gone = await seed({ attached: true });
    const bad = await seed({ object: false });
    await rejects(run([gone], [bad]));
    expect(callsOf('DeleteObjectCommand')).toEqual([]);
    expect(await prisma.upload.findUnique({ where: { key: gone } })).not.toBeNull();
  });

  it('ADM-02 · if the caller transaction fails, release is never called and the removed file stays', async () => {
    const gone = await seed({ attached: true });
    const fresh = await seed();
    await expect(
      prisma.$transaction(async (tx) => {
        await syncImages(tx, [gone], [fresh], 'admin', { uploadedById: OWNER });
        throw new Error('entity write failed');
      }),
    ).rejects.toThrow('entity write failed');
    expect(await attachedAt(fresh)).toBeNull();
    expect(callsOf('DeleteObjectCommand')).toEqual([]);
    expect(await prisma.upload.findUnique({ where: { key: gone } })).not.toBeNull();
  });

  it('ADM-02 · removing every image releases them all (scope avatar removal)', async () => {
    const a = await seed({ attached: true, scope: 'avatar' });
    const res = await run([a], [], 'avatar');
    await res.release();
    expect(res.removed).toEqual([a]);
    expect(s3State.deleted).toEqual([a]);
  });

  it('ADM-02 · scope is enforced through syncImages too', async () => {
    const avatar = await seed({ scope: 'avatar' });
    await rejects(run([], [avatar], 'admin'));
    const admin = await seed({ scope: 'admin' });
    await rejects(run([], [admin], 'avatar'));
  });

  it('ADM-02 · release() does nothing until called; skipping it after a rollback keeps the R2 object in place', async () => {
    // The returned release function is deferred — nothing is deleted before the caller awaits it.
    const toRemove = await seed({ attached: true });
    const toAdd = await seed();
    const result = await prisma.$transaction((tx) =>
      syncImages(tx, [toRemove], [toAdd], 'admin', { uploadedById: OWNER }),
    );
    expect(typeof result.release).toBe('function');
    expect(callsOf('DeleteObjectCommand')).toEqual([]); // commit happened, release not yet called
    await result.release();
    expect(callsOf('DeleteObjectCommand').map((c) => c.input.Key)).toEqual([toRemove]);

    // After a rollback the caller must not call release(); the object and row stay intact.
    resetS3();
    const gone2 = await seed({ attached: true });
    await expect(
      prisma.$transaction(async (tx) => {
        await syncImages(tx, [gone2], [], 'admin', { uploadedById: OWNER });
        throw new Error('entity write failed');
      }),
    ).rejects.toThrow('entity write failed');
    expect(callsOf('DeleteObjectCommand')).toEqual([]);
    expect(await prisma.upload.findUnique({ where: { key: gone2 } })).not.toBeNull();
  });
});
