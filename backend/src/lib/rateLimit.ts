import { createHmac } from 'node:crypto';
import { isIPv4, isIPv6 } from 'node:net';
import type { RequestHandler } from 'express';
import { rateLimit, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';
import { getEnv } from '../config/env.js';
import { AppError } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * MongoDB-backed rate limiting (ADR-012, NFR-01). Every hit is ONE atomic findAndModify upsert with an
 * update pipeline, so counts are correct across serverless instances. A plain `$inc` cannot reset an
 * expired window atomically (the TTL monitor lags up to ~60 s), hence the pipeline.
 * MongoDB's upsert duplicate-key protection depends on the UNIQUE index on `key`; without it concurrent
 * upserts insert duplicate counters. `ensureIndexes` therefore creates it itself (not only the TTL index),
 * so correctness never depends on `db push` having run against the database.
 */

const COLLECTION = 'rate_limits'; // @@map of the RateLimit model
const KEY_PREFIX = 'rl:';

/** Single entry point for raw MongoDB commands (a plain object, so tests can replace `run` reliably). */
export const db = {
  run: (command: Prisma.InputJsonObject) => prisma.$runCommandRaw(command),
};

type LogLike = Pick<Logger, 'error'>;

export class RateLimitStoreError extends Error {
  constructor(cause: unknown) {
    super('rate limit store unavailable', { cause });
    this.name = 'RateLimitStoreError';
  }
}

let fallbackLogger: Logger | undefined;
const defaultLog = (): LogLike => (fallbackLogger ??= createLogger(getEnv()));

// ---------------------------------------------------------------- keys

/** Expand an IPv6 address (optionally with a dotted IPv4 tail) to its 8 hextets, as numbers. */
function expandIPv6(ip: string): number[] | undefined {
  let addr = ip.split('%')[0]!.toLowerCase();
  const dot = addr.lastIndexOf(':') + 1;
  const tail = addr.slice(dot);
  if (tail.includes('.')) {
    if (!isIPv4(tail)) return undefined;
    const [a, b, c, d] = tail.split('.').map(Number) as [number, number, number, number];
    addr = `${addr.slice(0, dot)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = groups.map((g) => parseInt(g, 16));
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? nums
    : undefined;
}

/**
 * Client address used in keys: IPv4 as is, IPv4-mapped IPv6 (::ffff:1.2.3.4) as plain IPv4,
 * other IPv6 reduced to its /64 prefix (one subscriber can rotate through the whole /64).
 */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip.split('%')[0]!)) return 'unknown';
  const g = expandIPv6(ip);
  if (!g) return 'unknown';
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) {
    return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  }
  return `${g
    .slice(0, 4)
    .map((n) => n.toString(16))
    .join(':')}::/64`;
}

/** Lowercase + trim, then HMAC-SHA256 keyed with REFRESH_TOKEN_PEPPER: no plain emails in the collection. */
export function hashEmail(email: string): string {
  return createHmac('sha256', getEnv().REFRESH_TOKEN_PEPPER)
    .update(`rl-email:${email.trim().toLowerCase()}`)
    .digest('hex');
}

/** Namespaced counter key, e.g. `login:ip:203.0.113.7`, `login:email:<hmac>` or `upload:user:<userId>` (stored with an `rl:` prefix). */
export function limitKey(
  scope: string,
  kind: 'ip' | 'email' | 'user',
  value: string | undefined,
): string {
  const id =
    kind === 'ip' ? normalizeIp(value) : kind === 'email' ? hashEmail(value ?? '') : (value ?? '');
  return `${scope}:${kind}:${id}`;
}

// ---------------------------------------------------------------- indexes

let indexesReady: Promise<void> | undefined;

/**
 * Idempotent store indexes: the TTL on `resetAt` (Prisma cannot declare TTL indexes) and the UNIQUE index
 * on `key` that the upsert's duplicate-key protection needs. The unique index uses the exact name and spec
 * `prisma db push` creates (`rate_limits_key_key`), so this is a no-op where push already ran and never
 * conflicts with it. Memoized; a failure is retried on next call.
 */
export function ensureIndexes(): Promise<void> {
  indexesReady ??= db
    .run({
      createIndexes: COLLECTION,
      indexes: [
        { key: { resetAt: 1 }, name: 'resetAt_ttl', expireAfterSeconds: 0 },
        { key: { key: 1 }, name: 'rate_limits_key_key', unique: true },
      ],
    })
    .then(() => undefined)
    .catch((err: unknown) => {
      indexesReady = undefined;
      throw err;
    });
  return indexesReady;
}

/** Test hook: forget the memoized index promise. */
export function resetIndexMemo(): void {
  indexesReady = undefined;
}

// ---------------------------------------------------------------- core counter

export interface HitResult {
  /** false once `hits` exceeds `limit`. Always true when the store failed open. */
  allowed: boolean;
  hits: number;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
  /** true when MongoDB failed and the hit was NOT counted. */
  failedOpen: boolean;
}

const isDuplicateKey = (err: unknown): boolean => {
  const e = err as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  return (
    e?.code === 11000 ||
    e?.meta?.code === 11000 ||
    /E11000|duplicate key/i.test(`${String(e?.message)} ${String(e?.meta?.message)}`)
  );
};

const parseDate = (v: unknown): Date => {
  if (v instanceof Date) return v;
  const raw = v && typeof v === 'object' && '$date' in v ? (v as { $date: unknown }).$date : v;
  if (raw && typeof raw === 'object' && '$numberLong' in raw) {
    return new Date(Number((raw as { $numberLong: string }).$numberLong));
  }
  return new Date(raw as string | number);
};

async function upsertHit(
  fullKey: string,
  windowMs: number,
  now: Date,
): Promise<{ hits: number; resetAt: Date }> {
  const nowDate = { $date: now.toISOString() };
  const nextReset = { $date: new Date(now.getTime() + windowMs).toISOString() };
  const expired = { $lte: ['$resetAt', nowDate] }; // true for a missing field (new document) too
  const run = () =>
    db.run({
      findAndModify: COLLECTION,
      query: { key: fullKey },
      update: [
        {
          $set: {
            hits: { $cond: [expired, 1, { $add: [{ $ifNull: ['$hits', 0] }, 1] }] },
            resetAt: { $cond: [expired, nextReset, '$resetAt'] },
          },
        },
      ],
      upsert: true,
      new: true,
    });
  let res;
  try {
    res = await run();
  } catch (err) {
    // Two instances created the same key at once: the loser retries once and takes the update path.
    if (!isDuplicateKey(err)) throw err;
    res = await run();
  }
  const value = (res as { value?: { hits?: unknown; resetAt?: unknown } }).value;
  if (!value || typeof value.hits !== 'number') throw new Error('unexpected findAndModify result');
  return { hits: value.hits, resetAt: parseDate(value.resetAt) };
}

/** Count one hit for an already-prefixed key. Throws RateLimitStoreError when MongoDB fails. */
async function increment(fullKey: string, windowMs: number, now = new Date()) {
  try {
    await ensureIndexes();
    return await upsertHit(fullKey, windowMs, now);
  } catch (err) {
    throw new RateLimitStoreError(err);
  }
}

/**
 * Count one hit for `key` (see `limitKey`) in a fixed window. Reusable outside Express, e.g. login failures
 * per email (T-005). Fails open: if MongoDB errors the hit is not counted, an error is logged and
 * `{ allowed: true, failedOpen: true }` is returned. Never throws.
 */
export async function hit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts: { log?: LogLike; requestId?: string; now?: Date } = {},
): Promise<HitResult> {
  const now = opts.now ?? new Date();
  try {
    const { hits, resetAt } = await increment(KEY_PREFIX + key, windowSeconds * 1000, now);
    return {
      allowed: hits <= limit,
      hits,
      limit,
      remaining: Math.max(limit - hits, 0),
      resetAt,
      retryAfterSeconds: Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 1000)),
      failedOpen: false,
    };
  } catch (err) {
    (opts.log ?? defaultLog()).error(
      { err, requestId: opts.requestId, key: key.split(':').slice(0, 2).join(':') },
      'rate limit store failed, allowing request',
    );
    return {
      allowed: true,
      hits: 0,
      limit,
      remaining: limit,
      resetAt: new Date(now.getTime() + windowSeconds * 1000),
      retryAfterSeconds: 0,
      failedOpen: true,
    };
  }
}

/**
 * Read-only check: is `key` at or over `limit` in its current window? Does not count a hit.
 * Fails open (not locked) when MongoDB errors; logged.
 */
export async function peek(
  key: string,
  limit: number,
  opts: { log?: LogLike; requestId?: string; now?: Date } = {},
): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  const now = opts.now ?? new Date();
  try {
    const doc = await prisma.rateLimit.findUnique({ where: { key: KEY_PREFIX + key } });
    if (!doc || doc.hits < limit || doc.resetAt.getTime() <= now.getTime()) {
      return { locked: false, retryAfterSeconds: 0 };
    }
    return {
      locked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((doc.resetAt.getTime() - now.getTime()) / 1000)),
    };
  } catch (err) {
    (opts.log ?? defaultLog()).error({ err, requestId: opts.requestId }, 'rate limit peek failed');
    return { locked: false, retryAfterSeconds: 0 };
  }
}

/** Move the end of a key's window to now + `seconds` (e.g. a lockout that starts when the limit is reached). Fails open (logged). */
export async function extendWindow(
  key: string,
  seconds: number,
  opts: { log?: LogLike; requestId?: string; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  try {
    await prisma.rateLimit.updateMany({
      where: { key: KEY_PREFIX + key },
      data: { resetAt: new Date(now.getTime() + seconds * 1000) },
    });
  } catch (err) {
    (opts.log ?? defaultLog()).error(
      { err, requestId: opts.requestId },
      'rate limit extend failed',
    );
  }
}

/** Forget a counter, e.g. after a successful login. Fails open (logged). */
export async function resetKey(key: string, opts: { log?: LogLike; requestId?: string } = {}) {
  try {
    await prisma.rateLimit.deleteMany({ where: { key: KEY_PREFIX + key } });
  } catch (err) {
    (opts.log ?? defaultLog()).error({ err, requestId: opts.requestId }, 'rate limit reset failed');
  }
}

/** Same as `resetKey` but inside a caller's transaction: errors propagate (they abort it) instead of failing open. */
export async function resetKeyInTx(
  tx: Pick<Prisma.TransactionClient, 'rateLimit'>,
  key: string,
): Promise<void> {
  await tx.rateLimit.deleteMany({ where: { key: KEY_PREFIX + key } });
}

// ---------------------------------------------------------------- express-rate-limit store

export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  /** keys passed in are already namespaced (`limitKey`); the prefix is only used by `resetAll`. */
  constructor(private readonly scope: string) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { hits, resetAt } = await increment(KEY_PREFIX + key, this.windowMs);
    return { totalHits: hits, resetTime: resetAt };
  }

  async decrement(key: string): Promise<void> {
    await db.run({
      findAndModify: COLLECTION,
      query: { key: KEY_PREFIX + key, hits: { $gt: 0 } },
      update: { $inc: { hits: -1 } },
    });
  }

  async resetKey(key: string): Promise<void> {
    await prisma.rateLimit.deleteMany({ where: { key: KEY_PREFIX + key } });
  }

  async resetAll(): Promise<void> {
    await prisma.rateLimit.deleteMany({
      where: { key: { startsWith: `${KEY_PREFIX}${this.scope}:` } },
    });
  }
}

// ---------------------------------------------------------------- middleware

export interface RateLimiterOptions {
  /** Scope in the key: `rl:{name}:ip:{ip}`. */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Do not count responses with status < 400 (e.g. only failed logins count). */
  skipSuccessful?: boolean;
}

/**
 * Per-IP limiter. The IP is `req.ip` only, so the forwarded header counts only when Express trusts the
 * proxy (`TRUST_PROXY`). Over the limit -> 429 `RATE_LIMITED` (Error schema) with `Retry-After` and
 * `RateLimit` headers. If MongoDB fails the request is allowed and the error is logged with the request id.
 */
export function createRateLimiter(opts: RateLimiterOptions): RequestHandler {
  const inner = rateLimit({
    windowMs: opts.windowSeconds * 1000,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new MongoRateLimitStore(opts.name),
    skipSuccessfulRequests: opts.skipSuccessful ?? false,
    keyGenerator: (req) => limitKey(opts.name, 'ip', req.ip),
    // We own `trust proxy`; the library's own IP/proxy sanity checks would only log noise.
    validate: false,
    handler: (_req, _res, next) => {
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests'));
    },
  });
  return (req, res, next) => {
    inner(req, res, (err?: unknown) => {
      const cause = err instanceof Error ? err : undefined;
      if (cause instanceof RateLimitStoreError) {
        (req.log ?? defaultLog()).error(
          { err: cause, requestId: req.id, limiter: opts.name },
          'rate limit store failed, allowing request',
        );
        next();
        return;
      }
      next(err);
    });
  };
}
