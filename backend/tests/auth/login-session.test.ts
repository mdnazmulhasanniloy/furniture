import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_auth_t005',
  );
});

// Spy-able randomBytes (passes through unless a test queues a value) for the rollback test.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

import { randomBytes } from 'node:crypto';
import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { csrfTokenFor } from '../../src/lib/csrf.js';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { limitKey } from '../../src/lib/rateLimit.js';
import { hashRefreshToken, JWT_AUDIENCE, JWT_ISSUER } from '../../src/lib/tokens.js';
import { createApp } from '../../src/app.js';

const app = createApp();
const sendMail = vi.fn().mockResolvedValue({});
const env = getEnv();

const PASSWORD = 'Passw0rdOne';
const WRONG = 'Wr0ngPassword';
const EMAIL = 'user@example.com';
let passwordHash = '';

let now = Date.now();
const advance = (seconds: number) => {
  now += seconds * 1000;
  vi.setSystemTime(now);
};

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Alharbi',
      email: EMAIL,
      passwordHash,
      isVerified: true,
      ...over,
    },
  });

const login = (email = EMAIL, password = PASSWORD) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

/** `fx_rt=<token>` from a Set-Cookie header, ready to send back as a Cookie header. */
const cookieOf = (res: request.Response): string => {
  const sc = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = sc.find((s) => s.startsWith('fx_rt='));
  if (!c) throw new Error('no fx_rt cookie');
  return c.split(';')[0]!;
};
const rawOf = (cookie: string) => cookie.slice('fx_rt='.length);
const rowOf = (cookie: string) =>
  prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(rawOf(cookie)) } });

const csrfFor = async (cookie: string) =>
  (await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie)).body.csrfToken as string;

const refresh = (cookie: string, csrf?: string, headers: Record<string, string> = {}) => {
  const r = request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set(headers);
  return csrf === undefined ? r : r.set('X-CSRF-Token', csrf);
};
const logout = (cookie: string, csrf?: string) => {
  const r = request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
  return csrf === undefined ? r : r.set('X-CSRF-Token', csrf);
};

const sameError = ({ requestId: _id, ...rest }: Record<string, unknown>) => rest;
const loginOk = async (email = EMAIL) => {
  const res = await login(email);
  expect(res.status).toBe(200);
  return { res, cookie: cookieOf(res) };
};

async function wipe() {
  await Promise.all([
    prisma.otp.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.rateLimit.deleteMany(),
  ]);
  await prisma.user.deleteMany();
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  passwordHash = await hashPassword(PASSWORD);
});
beforeEach(async () => {
  await wipe();
  sendMail.mockClear();
  setTransport({ sendMail } as never);
  now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
});
afterEach(() => {
  vi.useRealTimers();
  setTransport(undefined);
});
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('POST /auth/login (AUTH-02)', () => {
  it('AUTH-02 · correct email + password returns an access token and an httpOnly refresh cookie', async () => {
    await mkUser();
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: EMAIL, role: 'CUSTOMER', isVerified: true });
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie']!)
      .find((c) => c.startsWith('fx_rt='))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    // The stored token is the keyed hash, never the raw value.
    const row = await rowOf(cookieOf(res));
    expect(row.tokenHash).not.toContain(rawOf(cookieOf(res)));
  });

  it('AUTH-02 · email is matched case-insensitively', async () => {
    await mkUser();
    expect((await login('USER@Example.com')).status).toBe(200);
  });

  it('AUTH-02 · argon2id hash verifies', async () => {
    const user = await mkUser();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(user.passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(user.passwordHash, WRONG)).toBe(false);
  });

  it('AUTH-02 · unknown email and wrong password return identical 401 INVALID_CREDENTIALS', async () => {
    await mkUser();
    const wrong = await login(EMAIL, WRONG);
    const unknown = await login('nobody@example.com', WRONG);
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.status).toBe(401);
    expect(sameError(unknown.body)).toEqual(sameError(wrong.body));
  });

  it('AUTH-02 · blocked/unverified status is not revealed with a wrong password', async () => {
    await mkUser({ email: 'blocked@example.com', isBlocked: true });
    await request(app).post('/api/v1/auth/register').send({
      firstName: 'Un',
      lastName: 'Verified',
      email: 'unver@example.com',
      password: PASSWORD,
    });
    const baseline = await login('nobody@example.com', WRONG);
    for (const email of ['blocked@example.com', 'unver@example.com']) {
      const res = await login(email, WRONG);
      expect(res.status).toBe(401);
      expect(sameError(res.body)).toEqual(sameError(baseline.body));
    }
    // ...and only a correct password reveals the status.
    const blocked = await login('blocked@example.com', PASSWORD);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('AUTH-02 · unverified login with the registration password sends a new OTP and returns 403 EMAIL_NOT_VERIFIED', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Sara', lastName: 'Alharbi', email: EMAIL, password: PASSWORD });
    expect(sendMail).toHaveBeenCalledTimes(1);
    advance(61); // past the 60 s resend cooldown

    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sendMail).toHaveBeenCalledTimes(2);

    const mail = sendMail.mock.calls.at(-1)![0] as { to: string; text: string };
    const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
    const verified = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: EMAIL, code });
    expect(verified.status).toBe(200);
  });

  it('AUTH-02 · unverified login inside the OTP cooldown sends no mail but answers the same 403', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Sara', lastName: 'Alharbi', email: EMAIL, password: PASSWORD });
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
    expect(sendMail).toHaveBeenCalledTimes(1); // only the register mail; no 429 that would act as an oracle
  });

  it('AUTH-01 · AUTH-02 · an attacker who registered later does not get a code bound to their data when the victim logs in', async () => {
    const PASS_A = 'Att4ckerPass';
    await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Sara', lastName: 'Alharbi', email: EMAIL, password: PASSWORD });
    advance(61);
    await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Mallory', lastName: 'Evil', email: EMAIL, password: PASS_A });
    advance(61);

    expect((await login(EMAIL, PASSWORD)).status).toBe(403);
    const mail = sendMail.mock.calls.at(-1)![0] as { text: string };
    const code = /\b(\d{6})\b/.exec(mail.text)![1]!;
    const verified = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: EMAIL, code });
    expect(verified.status).toBe(200);
    expect(verified.body.user.firstName).toBe('Sara'); // the victim's data, not the attacker's
    expect((await login(EMAIL, PASS_A)).status).toBe(401);
    expect((await login(EMAIL, PASSWORD)).status).toBe(200);
  });

  it('AUTH-02 · login with the wrong password for an unverified account sends no mail', async () => {
    await request(app)
      .post('/api/v1/auth/register')
      .send({ firstName: 'Sara', lastName: 'Alharbi', email: EMAIL, password: PASSWORD });
    advance(61);
    sendMail.mockClear();
    expect((await login(EMAIL, WRONG)).status).toBe(401);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-02 · blocked login with the correct password returns 403 ACCOUNT_BLOCKED and no session', async () => {
    await mkUser({ isBlocked: true });
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.refreshToken.count()).toBe(0);
  });
});

describe('AUTH-02 · lockout', () => {
  const MAX = env.LOGIN_MAX_FAILURES;
  const LOCK = env.LOGIN_LOCKOUT_SECONDS;
  const fail = async (email = EMAIL, n = MAX) => {
    for (let i = 0; i < n; i++) expect((await login(email, WRONG)).status).toBe(401);
  };

  it('AUTH-02 · LOGIN_MAX_FAILURES failures lock the account (429 ACCOUNT_LOCKED) until LOGIN_LOCKOUT_SECONDS pass; success resets the counter', async () => {
    await mkUser();
    await fail();
    const locked = await login(EMAIL, WRONG);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(Number(locked.headers['retry-after'])).toBe(LOCK);

    advance(LOCK - 1);
    expect((await login(EMAIL, WRONG)).status).toBe(429);
    advance(2);
    expect((await login()).status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedLoginCount).toBe(0);
    expect(user.lockedUntil).toBeNull();
    // the counter really restarted: a full set of MAX-1 failures does not lock again
    await fail(EMAIL, MAX - 1);
    expect((await login()).status).toBe(200);
  });

  it('AUTH-02 · during lockout a correct password also gets 429 (no password oracle)', async () => {
    await mkUser();
    await fail();
    const right = await login(EMAIL, PASSWORD);
    const wrong = await login(EMAIL, WRONG);
    expect(right.status).toBe(429);
    expect(right.body.code).toBe('ACCOUNT_LOCKED');
    expect(wrong.status).toBe(429);
    expect(sameError(right.body)).toEqual(sameError(wrong.body));
    expect(right.headers['set-cookie']).toBeUndefined();
  });

  it('AUTH-02 · lockout behaves identically for known and unknown emails', async () => {
    await mkUser();
    await fail(EMAIL);
    await fail('nobody@example.com');
    const known = await login(EMAIL, WRONG);
    const unknown = await login('nobody@example.com', WRONG);
    expect(known.status).toBe(429);
    expect(unknown.status).toBe(429);
    expect(sameError(unknown.body)).toEqual(sameError(known.body));
    expect(unknown.headers['retry-after']).toBe(known.headers['retry-after']);

    // and the unknown email unlocks on the same schedule
    advance(LOCK + 1);
    expect((await login('nobody@example.com', WRONG)).status).toBe(401);
  });

  it('AUTH-02 · the lockout state is the rate-limit key login:email:<hmac>, mirrored on the user for admins', async () => {
    await mkUser();
    await fail();
    const doc = await prisma.rateLimit.findUnique({
      where: { key: `rl:${limitKey('login', 'email', EMAIL)}` },
    });
    expect(doc?.hits).toBe(MAX);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedLoginCount).toBe(MAX);
    expect(user.lockedUntil?.getTime()).toBe(now + LOCK * 1000);
  });

  it('AUTH-02 · failedLoginCount and the lockout counter are exact under concurrent failures (atomic)', async () => {
    await mkUser();
    const results = await Promise.all(Array.from({ length: 4 }, () => login(EMAIL, WRONG)));
    expect(results.every((r) => r.status === 401)).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.failedLoginCount).toBe(4);
    const doc = await prisma.rateLimit.findUnique({
      where: { key: `rl:${limitKey('login', 'email', EMAIL)}` },
    });
    expect(doc?.hits).toBe(4);
  });

  it('AUTH-02 · 10 failed attempts in 15 min from one IP then 429 RATE_LIMITED (successful logins are not counted)', async () => {
    await mkUser();
    for (let i = 0; i < 12; i++) expect((await login()).status).toBe(200); // do not count
    for (let i = 1; i <= 10; i++) {
      expect((await login(`nobody${i}@example.com`, WRONG)).status).toBe(401);
    }
    const res = await login('nobody11@example.com', WRONG);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBeDefined();

    advance(901); // the window passes
    expect((await login('nobody12@example.com', WRONG)).status).toBe(401);
  });
});

describe('AUTH-05 · sessions', () => {
  it('AUTH-05 · refresh token TTL is REFRESH_TOKEN_TTL_SECONDS', async () => {
    await mkUser();
    const { res, cookie } = await loginOk();
    const sc = ([] as string[])
      .concat(res.headers['set-cookie']!)
      .find((c) => c.startsWith('fx_rt='))!;
    expect(sc).toMatch(new RegExp(`Max-Age=${env.REFRESH_TOKEN_TTL_SECONDS}`));
    expect((await rowOf(cookie)).expiresAt.getTime()).toBe(
      now + env.REFRESH_TOKEN_TTL_SECONDS * 1000,
    );
  });

  it('AUTH-05 · cookie flags follow env (Secure, SameSite, Domain)', async () => {
    await mkUser();
    const saved = {
      s: env.AUTH_COOKIE_SECURE,
      ss: env.AUTH_COOKIE_SAME_SITE,
      d: env.AUTH_COOKIE_DOMAIN,
    };
    Object.assign(env, {
      AUTH_COOKIE_SECURE: true,
      AUTH_COOKIE_SAME_SITE: 'none',
      AUTH_COOKIE_DOMAIN: 'example.com',
    });
    try {
      const res = await login();
      const sc = ([] as string[])
        .concat(res.headers['set-cookie']!)
        .find((c) => c.startsWith('fx_rt='))!;
      expect(sc).toMatch(/;\s*Secure/i);
      expect(sc).toMatch(/SameSite=None/i);
      expect(sc).toMatch(/Domain=example\.com/i);
      expect(sc).toMatch(/HttpOnly/i);
    } finally {
      Object.assign(env, {
        AUTH_COOKIE_SECURE: saved.s,
        AUTH_COOKIE_SAME_SITE: saved.ss,
        AUTH_COOKIE_DOMAIN: saved.d,
      });
    }
  });

  it('AUTH-02 · login number MAX_ACTIVE_SESSIONS+1 revokes the oldest session', async () => {
    await mkUser();
    const cookies: string[] = [];
    for (let i = 0; i < env.MAX_ACTIVE_SESSIONS + 1; i++) cookies.push((await loginOk()).cookie);

    const rows = await Promise.all(cookies.map(rowOf));
    expect(rows[0]!.revokedAt).toBeTruthy();
    expect(rows[0]!.rotatedAt ?? null).toBeNull(); // revoked by the cap, not by a rotation
    expect(rows.slice(1).every((r) => !r.revokedAt)).toBe(true);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(
      env.MAX_ACTIVE_SESSIONS,
    );
    // the revoked session cannot refresh, even with its own valid CSRF token
    expect((await refresh(cookies[0]!, csrfTokenFor(rows[0]!.familyId))).status).toBe(401);
    expect((await refresh(cookies[1]!, csrfTokenFor(rows[1]!.familyId))).status).toBe(200);
  });

  it('AUTH-02 · session-cap revoke rolls back if the new token create fails', async () => {
    const user = await mkUser();
    for (let i = 0; i < env.MAX_ACTIVE_SESSIONS; i++) await loginOk(); // the user is exactly at the cap
    const activeBefore = await prisma.refreshToken.findMany({ where: { revokedAt: null } });
    expect(activeBefore).toHaveLength(env.MAX_ACTIVE_SESSIONS);

    // Make the next login's token collide with an existing tokenHash: the cap revoke runs first inside
    // the transaction, then the create fails on the unique index.
    const fixed = Buffer.alloc(32, 7);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: 'collision',
        tokenHash: hashRefreshToken(fixed.toString('base64url')),
        expiresAt: new Date(now + 1e7),
        revokedAt: new Date(now), // already revoked, so it does not count toward the cap
      },
    });
    vi.mocked(randomBytes).mockReturnValueOnce(fixed as never);

    const res = await login();
    expect(res.status).toBe(500);

    // Rolled back: nobody was revoked, no new session exists.
    const activeAfter = await prisma.refreshToken.findMany({ where: { revokedAt: null } });
    expect(activeAfter.map((r) => r.id).sort()).toEqual(activeBefore.map((r) => r.id).sort());
    expect(await prisma.refreshToken.count()).toBe(env.MAX_ACTIVE_SESSIONS + 1); // + the collision row only
  });

  it('AUTH-02 · concurrent logins of one user all succeed and never leave more than MAX_ACTIVE_SESSIONS active', async () => {
    await mkUser();
    const results = await Promise.all(Array.from({ length: 4 }, () => login()));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBeLessThanOrEqual(
      env.MAX_ACTIVE_SESSIONS,
    );
    expect(await prisma.refreshToken.count()).toBe(4);
  });

  it('AUTH-05 · refresh rotates the token, keeps the family and returns a working access token', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const res = await refresh(a, csrf);
    expect(res.status).toBe(200);
    const b = cookieOf(res);
    expect(b).not.toBe(a);
    const [rowA, rowB] = await Promise.all([rowOf(a), rowOf(b)]);
    expect(rowA.revokedAt).toBeTruthy();
    expect(rowA.rotatedAt).toBeTruthy();
    expect(rowB.familyId).toBe(rowA.familyId);
    expect(rowB.revokedAt ?? null).toBeNull();
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(EMAIL);
  });

  it('AUTH-05 · a just-rotated token presented again within 10 s gets 401 REFRESH_RACE and the family is NOT revoked', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const b = cookieOf(await refresh(a, csrf));

    advance(9);
    const race = await refresh(a, csrf);
    expect(race.status).toBe(401);
    expect(race.body.code).toBe('REFRESH_RACE');
    expect((await rowOf(b)).revokedAt ?? null).toBeNull();
    expect((await refresh(b, csrf)).status).toBe(200); // the client retries with the new cookie
  });

  it('AUTH-05 · two concurrent refreshes with the same token: one wins, the other gets REFRESH_RACE', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const [x, y] = await Promise.all([refresh(a, csrf), refresh(a, csrf)]);
    expect([x.status, y.status].sort()).toEqual([200, 401]);
    const lost = x.status === 401 ? x : y;
    expect(lost.body.code).toBe('REFRESH_RACE');
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('AUTH-05 · reuse of a rotated token after the grace window revokes the whole family, not other sessions', async () => {
    await mkUser();
    const { cookie: other } = await loginOk(); // a second, unrelated session
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const b = cookieOf(await refresh(a, csrf));

    advance(11);
    const reuse = await refresh(a, csrf);
    expect(reuse.status).toBe(401);
    expect(reuse.body.code).toBe('UNAUTHORIZED');
    expect((await rowOf(b)).revokedAt).toBeTruthy(); // the thief's and the owner's current token are both dead
    expect((await refresh(b, csrf)).status).toBe(401);
    expect((await rowOf(other)).revokedAt ?? null).toBeNull();
  });

  it('AUTH-05 · refresh with a missing, unknown or expired token returns 401', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    expect((await request(app).post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf)).status).toBe(
      401,
    );
    expect((await refresh('fx_rt=not-a-real-token', csrf)).status).toBe(401);
    advance(env.REFRESH_TOKEN_TTL_SECONDS + 1);
    expect((await refresh(a, csrf)).status).toBe(401);
  });

  it('AUTH-05 · refresh for a blocked user returns 401', async () => {
    const user = await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    await prisma.user.update({ where: { id: user.id }, data: { isBlocked: true } });
    expect((await refresh(a, csrf)).status).toBe(401);
  });

  it('AUTH-05 · /auth/refresh and /auth/logout without or with a bad X-CSRF-Token return 403 CSRF_INVALID; with a valid one they succeed', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const { cookie: other } = await loginOk();
    const goodCsrf = await csrfFor(a);
    const otherCsrf = await csrfFor(other);

    for (const bad of [undefined, 'garbage', otherCsrf]) {
      const r = await refresh(a, bad);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('CSRF_INVALID');
      const l = await logout(a, bad);
      expect(l.status).toBe(403);
      expect(l.body.code).toBe('CSRF_INVALID');
    }
    expect((await rowOf(a)).revokedAt ?? null).toBeNull(); // rejected requests changed nothing

    const next = await refresh(a, goodCsrf);
    expect(next.status).toBe(200);
    expect((await logout(cookieOf(next), goodCsrf)).status).toBe(204);
  });

  it('AUTH-05 · CSRF token stays valid after a refresh rotation', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    let cookie = a;
    for (let i = 0; i < 3; i++) {
      advance(1);
      const res = await refresh(cookie, csrf);
      expect(res.status).toBe(200);
      cookie = cookieOf(res);
      expect(await csrfFor(cookie)).toBe(csrf); // same family, same token
    }
  });

  it('AUTH-05 · GET /auth/csrf without a valid refresh cookie returns 401', async () => {
    await mkUser();
    expect((await request(app).get('/api/v1/auth/csrf')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/csrf').set('Cookie', 'fx_rt=nope')).status).toBe(
      401,
    );
    const { cookie } = await loginOk();
    await logout(cookie, await csrfFor(cookie));
    expect((await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie)).status).toBe(401);
  });

  it('AUTH-05 · a cookie-authenticated request whose Origin is not in CORS_ALLOWED_ORIGINS gets 403 CSRF_INVALID', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const saved = env.CORS_ALLOWED_ORIGINS;
    Object.assign(env, { CORS_ALLOWED_ORIGINS: ['http://localhost:3100'] });
    try {
      const bad = await refresh(a, csrf, { Origin: 'https://evil.example' });
      expect(bad.status).toBe(403);
      expect(bad.body.code).toBe('CSRF_INVALID');
      expect((await logout(a, csrf).set('Origin', 'https://evil.example')).status).toBe(403);
      expect((await rowOf(a)).revokedAt ?? null).toBeNull();

      expect((await refresh(a, csrf, { Origin: 'http://localhost:3100' })).status).toBe(200);
    } finally {
      Object.assign(env, { CORS_ALLOWED_ORIGINS: saved });
    }
  });

  it('AUTH-05 · logout revokes the session family and clears the cookie', async () => {
    await mkUser();
    const { cookie: a } = await loginOk();
    const csrf = await csrfFor(a);
    const b = cookieOf(await refresh(a, csrf));
    const res = await logout(b, csrf);
    expect(res.status).toBe(204);
    const cleared = ([] as string[])
      .concat(res.headers['set-cookie']!)
      .find((c) => c.startsWith('fx_rt='))!;
    expect(cleared).toMatch(/fx_rt=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await rowOf(b)).revokedAt).toBeTruthy();
    expect((await refresh(b, csrf)).status).toBe(401);
  });

  it('AUTH-05 · logout with only a Bearer token needs no CSRF token; with nothing it returns 401', async () => {
    await mkUser();
    const { res } = await loginOk();
    const ok = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(ok.status).toBe(204);
    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(401);
  });

  it('AUTH-05 · GET /auth/me returns the current user and 401 without a token', async () => {
    await mkUser();
    const { res } = await loginOk();
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ email: EMAIL, firstName: 'Sara', role: 'CUSTOMER' });
    expect(me.body.passwordHash).toBeUndefined();
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('AUTH-05 · the access token carries iss, aud, sub, role and jti and is HS256', async () => {
    const user = await mkUser();
    const { res } = await loginOk();
    const decoded = jwt.decode(res.body.accessToken, { complete: true })!;
    expect(decoded.header.alg).toBe('HS256');
    expect(decoded.payload).toMatchObject({
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      sub: user.id,
      role: 'CUSTOMER',
    });
    expect((decoded.payload as { jti: string }).jti).toEqual(expect.any(String));
    const second = jwt.decode((await loginOk()).res.body.accessToken) as { jti: string };
    expect(second.jti).not.toBe((decoded.payload as { jti: string }).jti);
  });
});
