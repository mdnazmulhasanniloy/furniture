import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import express from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_ratelimit_t024',
  );
});

import { createErrorHandler, notFoundHandler } from '../../src/middleware/error.js';
import { requestId } from '../../src/middleware/requestId.js';
import {
  createRateLimiter,
  db,
  ensureIndexes,
  hit,
  limitKey,
  MongoRateLimitStore,
  normalizeIp,
  resetIndexMemo,
  resetKey,
} from '../../src/lib/rateLimit.js';
import { prisma } from '../../src/lib/prisma.js';

/** A small app with the real requestId + error handler and one limited route (no production route is limited yet). */
function buildApp(opts: {
  trustProxy: boolean | number;
  limit?: number;
  windowSeconds?: number;
  skipSuccessful?: boolean;
  logLines?: string[];
}) {
  const lines = opts.logLines;
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines?.push(chunk.toString());
      cb();
    },
  });
  const logger = pino({ level: 'error' }, stream);
  const app = express();
  app.set('trust proxy', opts.trustProxy);
  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id }));
  app.get(
    '/login',
    createRateLimiter({
      name: 'login',
      limit: opts.limit ?? 10,
      windowSeconds: opts.windowSeconds ?? 900,
      skipSuccessful: opts.skipSuccessful ?? false,
    }),
    (req, res) => {
      if ('fail' in req.query) {
        res.status(400).json({ ip: req.ip });
        return;
      }
      res.json({ ip: req.ip });
    },
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

const getFrom = (app: express.Express, xff?: string) => {
  const r = request(app).get('/login');
  return xff ? r.set('X-Forwarded-For', xff) : r;
};

beforeAll(async () => {
  // The schema (notably the UNIQUE index on rate_limits.key) must exist in this file's own database:
  // without it, concurrent upserts can insert duplicate counter documents (lost updates, flaky NFR-01).
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await prisma.$connect();
});

beforeEach(async () => {
  resetIndexMemo();
  await prisma.rateLimit.deleteMany();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NFR-01 · rate limit store', () => {
  it('NFR-01 · ensureIndexes creates the TTL and the UNIQUE key index on an empty database', async () => {
    // Correctness must not depend on `db push` having run on the deployed database (Atlas):
    // the unique index is what makes concurrent upserts collide instead of inserting duplicates.
    await db.run({ drop: 'rate_limits' }).catch(() => undefined); // NamespaceNotFound is fine
    resetIndexMemo();
    await ensureIndexes();
    const res = (await db.run({ listIndexes: 'rate_limits' })) as {
      cursor?: { firstBatch?: { name?: string }[] };
    };
    const byName = new Map((res.cursor?.firstBatch ?? []).map((i) => [i.name, i]));
    expect(byName.get('resetAt_ttl')).toMatchObject({
      key: { resetAt: 1 },
      expireAfterSeconds: 0,
    });
    expect(byName.get('rate_limits_key_key')).toMatchObject({ key: { key: 1 }, unique: true });
    // Idempotent where `db push` already created the same index (same name, same spec).
    resetIndexMemo();
    await expect(ensureIndexes()).resolves.toBeUndefined();
  });

  it('NFR-01 · the limit is enforced with the Error schema, Retry-After and RateLimit headers', async () => {
    const app = buildApp({ trustProxy: false, limit: 3, windowSeconds: 900 });
    for (let i = 1; i <= 3; i++) {
      const ok = await getFrom(app);
      expect(ok.status).toBe(200);
      expect(ok.headers['ratelimit']).toBe(
        `limit=3, remaining=${3 - i}, reset=${ok.headers['ratelimit']!.split('reset=')[1]}`,
      );
    }
    const res = await getFrom(app);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect(res.headers['ratelimit']).toMatch(/^limit=3, remaining=0, reset=\d+$/);
    expect(res.headers['ratelimit-policy']).toBe('3;w=900');
  });

  it('NFR-01 · counters are stored in the RateLimit collection as rl:{scope}:{kind}:{id}', async () => {
    const app = buildApp({ trustProxy: false });
    await getFrom(app);
    await getFrom(app);
    const doc = await prisma.rateLimit.findUnique({ where: { key: 'rl:login:ip:127.0.0.1' } });
    expect(doc?.hits).toBe(2);
    expect(doc?.resetAt).toBeInstanceOf(Date);
    expect(doc!.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('NFR-01 · the window resets after it passes, even before the TTL index removes the document', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const app = buildApp({ trustProxy: false, limit: 2, windowSeconds: 60 });
    expect((await getFrom(app)).status).toBe(200);
    expect((await getFrom(app)).status).toBe(200);
    expect((await getFrom(app)).status).toBe(429);

    vi.setSystemTime(Date.now() + 61_000);
    // The expired document still exists (TTL monitor has not run) and must be reset, not incremented.
    expect(await prisma.rateLimit.count()).toBe(1);
    const again = await getFrom(app);
    expect(again.status).toBe(200);
    expect(again.headers['ratelimit']).toMatch(/^limit=2, remaining=1, reset=60$/);
    expect((await prisma.rateLimit.findFirst())?.hits).toBe(1);
  });

  it('NFR-01 · two app instances sharing the store count together (11th login attempt in 15 min -> 429)', async () => {
    const a = buildApp({ trustProxy: false, limit: 10, windowSeconds: 900 });
    const b = buildApp({ trustProxy: false, limit: 10, windowSeconds: 900 });
    for (let i = 0; i < 6; i++) expect((await getFrom(a)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await getFrom(b)).status).toBe(200);
    expect((await getFrom(a)).status).toBe(429);
    expect((await getFrom(b)).status).toBe(429);
  });

  it('NFR-01 · concurrent hits are counted exactly (atomic upsert, no lost updates)', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => hit('login:ip:concurrent', 100, 60)),
    );
    expect(results.every((r) => !r.failedOpen)).toBe(true);
    expect(results.map((r) => r.hits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 25 }, (_, i) => i + 1),
    );
    expect(
      (await prisma.rateLimit.findUnique({ where: { key: 'rl:login:ip:concurrent' } }))?.hits,
    ).toBe(25);
  });

  it('NFR-01 · hit() reports allowed, remaining and retryAfterSeconds; resetKey clears the counter', async () => {
    const r1 = await hit('login:email:x', 2, 60);
    expect(r1).toMatchObject({ allowed: true, hits: 1, remaining: 1, failedOpen: false });
    await hit('login:email:x', 2, 60);
    const r3 = await hit('login:email:x', 2, 60);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfterSeconds).toBeGreaterThan(0);
    expect(r3.retryAfterSeconds).toBeLessThanOrEqual(60);
    await resetKey('login:email:x');
    expect((await hit('login:email:x', 2, 60)).hits).toBe(1);
  });

  it('NFR-01 · the TTL index on resetAt exists with expireAfterSeconds 0 and ensureIndexes is idempotent', async () => {
    await ensureIndexes();
    resetIndexMemo();
    await ensureIndexes();
    const res = (await prisma.$runCommandRaw({ listIndexes: 'rate_limits' })) as {
      cursor: {
        firstBatch: { name: string; key: Record<string, number>; expireAfterSeconds?: number }[];
      };
    };
    const ttl = res.cursor.firstBatch.filter((i) => i.key.resetAt === 1);
    expect(ttl).toHaveLength(1);
    expect(ttl[0]!.expireAfterSeconds).toBe(0);
  });
});

describe('NFR-01 · express-rate-limit store methods', () => {
  const hitsOf = async (key: string) =>
    (await prisma.rateLimit.findUnique({ where: { key: `rl:${key}` } }))?.hits;

  it('NFR-01 · decrement lowers the count and never goes below 0', async () => {
    const store = new MongoRateLimitStore('login');
    await store.increment('login:ip:dec');
    await store.increment('login:ip:dec');
    await store.decrement('login:ip:dec');
    expect(await hitsOf('login:ip:dec')).toBe(1);
    await store.decrement('login:ip:dec');
    expect(await hitsOf('login:ip:dec')).toBe(0);
    await store.decrement('login:ip:dec');
    await store.decrement('login:ip:dec');
    expect(await hitsOf('login:ip:dec')).toBe(0);
    await expect(store.decrement('login:ip:missing')).resolves.toBeUndefined();
  });

  it('NFR-01 · store.resetKey clears exactly one key', async () => {
    const store = new MongoRateLimitStore('login');
    await store.increment('login:ip:a');
    await store.increment('login:ip:b');
    await store.resetKey('login:ip:a');
    expect(await hitsOf('login:ip:a')).toBeUndefined();
    expect(await hitsOf('login:ip:b')).toBe(1);
  });

  it('NFR-01 · store.resetAll clears only keys of its own scope and leaves other scopes untouched', async () => {
    const login = new MongoRateLimitStore('login');
    const otp = new MongoRateLimitStore('otp');
    await login.increment('login:ip:a');
    await login.increment('login:email:b');
    await otp.increment('otp:ip:a');
    await login.resetAll();
    expect(await hitsOf('login:ip:a')).toBeUndefined();
    expect(await hitsOf('login:email:b')).toBeUndefined();
    expect(await hitsOf('otp:ip:a')).toBe(1);
  });
});

describe('NFR-01 · client IP', () => {
  it('NFR-01 · TRUST_PROXY=1 uses the forwarded IP', async () => {
    const app = buildApp({ trustProxy: 1, limit: 1 });
    expect((await getFrom(app, '203.0.113.1')).status).toBe(200);
    expect((await getFrom(app, '203.0.113.1')).status).toBe(429);
    const other = await getFrom(app, '203.0.113.2');
    expect(other.status).toBe(200);
    expect(other.body.ip).toBe('203.0.113.2');
  });

  it('NFR-01 · TRUST_PROXY=false ignores X-Forwarded-For (it cannot be used to dodge the limit)', async () => {
    const app = buildApp({ trustProxy: false, limit: 2 });
    expect((await getFrom(app, '203.0.113.1')).status).toBe(200);
    expect((await getFrom(app, '203.0.113.2')).status).toBe(200);
    expect((await getFrom(app, '203.0.113.3')).status).toBe(429);
    expect(await prisma.rateLimit.count()).toBe(1);
  });

  it('NFR-01 · two IPv6 addresses in the same /64 share one counter', async () => {
    const app = buildApp({ trustProxy: 1, limit: 2 });
    expect((await getFrom(app, '2001:db8:1:2:aaaa::1')).status).toBe(200);
    expect((await getFrom(app, '2001:db8:1:2:bbbb:cccc:dddd:2')).status).toBe(200);
    expect((await getFrom(app, '2001:0db8:0001:0002::ffff')).status).toBe(429);
    expect(normalizeIp('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64');
  });

  it('NFR-01 · different /64 prefixes are independent', async () => {
    const app = buildApp({ trustProxy: 1, limit: 1 });
    expect((await getFrom(app, '2001:db8:1:2::1')).status).toBe(200);
    expect((await getFrom(app, '2001:db8:1:2::2')).status).toBe(429);
    expect((await getFrom(app, '2001:db8:1:3::1')).status).toBe(200);
    expect((await getFrom(app, '2001:db8:2:2::1')).status).toBe(200);
  });

  it('NFR-01 · ::ffff:1.2.3.4 and 1.2.3.4 share one counter', async () => {
    const app = buildApp({ trustProxy: 1, limit: 2 });
    expect((await getFrom(app, '1.2.3.4')).status).toBe(200);
    expect((await getFrom(app, '::ffff:1.2.3.4')).status).toBe(200);
    expect((await getFrom(app, '::ffff:0102:0304')).status).toBe(429);
    expect(await prisma.rateLimit.count()).toBe(1);
    expect(normalizeIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normalizeIp('1.2.3.4')).toBe('1.2.3.4');
  });

  it('NFR-01 · normalizeIp handles IPv4, IPv6 forms and garbage', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8:0:0::/64');
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(normalizeIp('64:ff9b::1.2.3.4')).toBe('64:ff9b:0:0::/64');
    expect(normalizeIp(undefined)).toBe('unknown');
    expect(normalizeIp('not an ip')).toBe('unknown');
  });
});

describe('NFR-01 · email keys', () => {
  it('NFR-01 · email keys are lowercased and trimmed, HMAC-hashed (not plain SHA-256), and stored without the email', async () => {
    const k1 = limitKey('login', 'email', ' User@Example.com ');
    expect(limitKey('login', 'email', 'user@example.com')).toBe(k1);
    expect(limitKey('login', 'email', 'other@example.com')).not.toBe(k1);
    expect(limitKey('otp', 'email', 'user@example.com')).not.toBe(k1);

    const id = k1.split(':')[2]!;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(createHash('sha256').update('user@example.com').digest('hex'));
    expect(id).not.toBe(createHash('sha256').update('rl-email:user@example.com').digest('hex'));

    await hit(k1, 5, 60);
    const docs = await prisma.rateLimit.findMany();
    expect(docs).toHaveLength(1);
    expect(docs[0]!.key).toBe(`rl:${k1}`);
    expect(docs[0]!.key).not.toContain('example');
    // Same counter regardless of case/whitespace.
    expect((await hit(limitKey('login', 'email', 'USER@example.com'), 5, 60)).hits).toBe(2);
  });
});

describe('NFR-01 · duplicate-key race', () => {
  it('NFR-01 · a duplicate-key error on the first upsert is retried once and takes the update path', async () => {
    await ensureIndexes();
    const real = db.run.bind(db);
    const spy = vi.spyOn(db, 'run').mockImplementationOnce((async (cmd: never) => {
      // Another instance wins the insert race (creates the document with hits = 1), ours gets E11000.
      await real(cmd);
      throw new Error(
        'Command failed: E11000 duplicate key error collection: rate_limits index: key_1',
      );
    }) as never);

    const res = await hit('login:ip:race', 10, 60);

    expect(res.failedOpen).toBe(false);
    expect(res.hits).toBe(2); // the other instance's 1 + our retried increment
    expect(spy).toHaveBeenCalledTimes(2); // failed first attempt + one retry
    const docs = await prisma.rateLimit.findMany({ where: { key: 'rl:login:ip:race' } });
    expect(docs).toHaveLength(1);
    expect(docs[0]!.hits).toBe(2);
  });

  it('NFR-01 · a duplicate-key error that repeats on the retry fails open instead of retrying forever', async () => {
    await ensureIndexes();
    const spy = vi.spyOn(db, 'run').mockRejectedValue(new Error('E11000 duplicate key error'));
    const log = { error: vi.fn() };
    const res = await hit('login:ip:race2', 10, 60, { log });
    expect(res.failedOpen).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledOnce();
  });
});

describe('NFR-01 · fail open', () => {
  it('NFR-01 · when MongoDB fails the request is allowed and the error is logged with the request id', async () => {
    const lines: string[] = [];
    const app = buildApp({ trustProxy: false, limit: 1, logLines: lines });
    vi.spyOn(db, 'run').mockRejectedValue(new Error('mongo down'));

    for (let i = 0; i < 3; i++) {
      const res = await getFrom(app);
      expect(res.status).toBe(200); // never 429/500, even past the limit
      const entries = lines.map(
        (l) => JSON.parse(l) as { level: number; requestId?: string; msg: string },
      );
      const logged = entries.find(
        (e) =>
          e.level === 50 && e.requestId === res.headers['x-request-id'] && /rate limit/.test(e.msg),
      );
      expect(logged).toBeDefined();
    }
  });

  it('NFR-01 · hit() fails open when MongoDB fails: allowed, not counted, logged, never throws', async () => {
    vi.spyOn(db, 'run').mockRejectedValue(new Error('mongo down'));
    const log = { error: vi.fn() };
    const res = await hit('login:email:down', 1, 60, { log, requestId: 'req-1' });
    expect(res).toMatchObject({ allowed: true, failedOpen: true });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-1' }),
      expect.stringContaining('rate limit'),
    );
  });

  it('NFR-01 · a failing store does not break the limiter once MongoDB is back (index memo is retried)', async () => {
    const app = buildApp({ trustProxy: false, limit: 1 });
    const spy = vi.spyOn(db, 'run').mockRejectedValueOnce(new Error('mongo blip'));
    expect((await getFrom(app)).status).toBe(200); // failed open
    spy.mockRestore();
    expect((await getFrom(app)).status).toBe(200); // 1st counted hit
    expect((await getFrom(app)).status).toBe(429);
  });
});

describe('NFR-01 · skipSuccessful refund timing (AUTH-03 flake regression)', () => {
  it('NFR-01 · the success refund is stored before the response is sent, so the next request never sees the un-refunded hit, even when the refund write is slow', async () => {
    await ensureIndexes();
    // Delay every decrement by 30 ms. Before the fix the refund ran as an unawaited response-'finish'
    // decrement, so the same client's NEXT request raced it and could see the un-refunded count
    // (AUTH-03 "successful resets do not count": 429 instead of 400 under full-suite load).
    const real = db.run.bind(db);
    vi.spyOn(db, 'run').mockImplementation((async (cmd: Record<string, unknown>) => {
      const inc = (cmd as { update?: { $inc?: { hits?: number } } }).update?.$inc?.hits;
      if (inc === -1) await new Promise((r) => setTimeout(r, 30));
      return real(cmd as never);
    }) as never);

    const app = buildApp({ trustProxy: false, limit: 2, skipSuccessful: true });
    const go = (fail: boolean) => request(app).get(fail ? '/login?fail=1' : '/login');

    expect((await go(true)).status).toBe(400); // 1st counted failure
    expect((await go(false)).status).toBe(200); // counted, then refunded BEFORE this response resolves
    const doc = await prisma.rateLimit.findUnique({ where: { key: 'rl:login:ip:127.0.0.1' } });
    expect(doc?.hits).toBe(1); // the refund already landed
    expect((await go(true)).status).toBe(400); // 2nd failure — raced the refund and got 429 before the fix
    expect((await go(true)).status).toBe(429); // 3rd failure is over the limit of 2
  });
});
