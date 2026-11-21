import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_auth_t006',
  );
});

// Spy-able dummyVerify (passes through) to prove every failure path spends an argon2 verify.
vi.mock('../../src/lib/password.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/password.js')>();
  return { ...actual, dummyVerify: vi.fn(actual.dummyVerify) };
});

import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { csrfTokenFor } from '../../src/lib/csrf.js';
import { createLogger } from '../../src/lib/logger.js';
import { dummyVerify, hashPassword, verifyPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { limitKey } from '../../src/lib/rateLimit.js';
import { createApp } from '../../src/app.js';
import { createOtp } from '../../src/modules/auth/otp.service.js';

const app = createApp();
const sendMail = vi.fn().mockResolvedValue({});
const env = getEnv();

const OLD = 'Passw0rdOld';
const NEW = 'Br4ndNewPass';
const EMAIL = 'user@example.com';
const UNKNOWN = 'nobody@example.com';
let oldHash = '';

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
      passwordHash: oldHash,
      isVerified: true,
      ...over,
    },
  });

const forgot = (email = EMAIL, headers: Record<string, string> = {}) =>
  request(app).post('/api/v1/auth/forgot-password').set(headers).send({ email });
const reset = (
  email: string,
  code: string,
  newPassword = NEW,
  headers: Record<string, string> = {},
  a = app,
) => request(a).post('/api/v1/auth/reset-password').set(headers).send({ email, code, newPassword });
const login = (email = EMAIL, password = OLD) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

const mails = () =>
  sendMail.mock.calls.map(
    (c) => c[0] as { to: string; subject: string; text: string; html: string },
  );
/** Code of the last mail that carries a 6-digit code (the reset OTP mail). */
const lastCode = (): string => {
  for (const m of mails().reverse()) {
    const hit = /\b(\d{6})\b/.exec(m.text);
    if (hit) return hit[1]!;
  }
  throw new Error('no code mailed');
};
/** Request a reset code the real way and return it. */
const requestCode = async (email = EMAIL) => {
  expect((await forgot(email)).status).toBe(200);
  return lastCode();
};
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');
const sameError = ({ requestId: _id, ...rest }: Record<string, unknown>) => rest;
const mailCount = () => sendMail.mock.calls.length;

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
  oldHash = await hashPassword(OLD);
});
beforeEach(async () => {
  await wipe();
  sendMail.mockClear();
  vi.mocked(dummyVerify).mockClear();
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

describe('POST /auth/forgot-password (AUTH-03)', () => {
  it('AUTH-03 · a registered email gets a RESET_PASSWORD OTP by mail, in en and ar, stored hashed', async () => {
    await mkUser();
    const res = await forgot(EMAIL, { 'Accept-Language': 'en' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['message']);
    const en = mails().at(-1)!;
    expect(en.to).toBe(EMAIL);
    expect(en.subject).toMatch(/Reset your/);
    const code = lastCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(res.body.message).not.toContain(code);

    const row = await prisma.otp.findFirstOrThrow({ where: { email: EMAIL } });
    expect(row.purpose).toBe('RESET_PASSWORD');
    expect(row.codeHash).not.toContain(code);

    advance(61);
    await forgot(EMAIL, { 'Accept-Language': 'ar' });
    expect(mails().at(-1)!.subject).toMatch(/إعادة تعيين/);
  });

  it('AUTH-03 · unknown, blocked and unverified emails get the identical 200 and no mail', async () => {
    await mkUser();
    await mkUser({ email: 'blocked@example.com', isBlocked: true });
    await mkUser({ email: 'unverified@example.com', isVerified: false });
    const known = await forgot(EMAIL);
    expect(mailCount()).toBe(1);
    sendMail.mockClear();
    for (const email of [UNKNOWN, 'blocked@example.com', 'unverified@example.com']) {
      const res = await forgot(email);
      expect(res.status, email).toBe(200);
      expect(res.body, email).toEqual(known.body);
    }
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-03 · cooldown and hourly cap return 429 identically for known and unknown emails', async () => {
    await mkUser();
    const seqs: number[][] = [];
    for (const email of [EMAIL, UNKNOWN]) {
      const seq: number[] = [];
      for (let i = 0; i < 7; i++) {
        seq.push((await forgot(email)).status);
        advance(61);
      }
      seqs.push(seq);
    }
    expect(seqs[0]).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(seqs[1]).toEqual(seqs[0]);

    // 60 s cooldown right after a request
    advance(3600);
    expect((await forgot(EMAIL)).status).toBe(200);
    const again = await forgot(EMAIL);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('RATE_LIMITED');
  });

  it('AUTH-03 · a malformed email → 422', async () => {
    expect((await forgot('not-an-email')).status).toBe(422);
  });
});

describe('POST /auth/reset-password (AUTH-03)', () => {
  it('AUTH-03 · a valid OTP changes the password (argon2id), does not log in, and returns only a message', async () => {
    const user = await mkUser();
    const code = await requestCode();
    const res = await reset(EMAIL, code, NEW, { 'Accept-Language': 'en' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['message']);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(NEW);
    expect(JSON.stringify(res.body)).not.toContain(code);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(after.passwordHash, NEW)).toBe(true);
    expect(after.passwordChangedAt).toBeInstanceOf(Date);
    expect((await login(EMAIL, OLD)).status).toBe(401);
    expect((await login(EMAIL, NEW)).status).toBe(200);

    const ar = await reset(
      EMAIL,
      await (async () => {
        advance(61);
        return requestCode();
      })(),
      'An0therPass1',
      { 'Accept-Language': 'ar' },
    );
    expect(ar.status).toBe(200);
    expect(ar.body.message).not.toBe(res.body.message);
  });

  it('AUTH-03 · reset revokes every refresh token of the user, across sessions', async () => {
    const user = await mkUser();
    const a = await login();
    const b = await login();
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const other = await mkUser({ email: 'other@example.com' });
    const otherSession = await login('other@example.com');
    expect(otherSession.status).toBe(200);

    expect((await reset(EMAIL, await requestCode())).status).toBe(200);

    const rows = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    const cookie = ([] as string[])
      .concat(a.headers['set-cookie']!)
      .find((c) => c.startsWith('fx_rt='))!
      .split(';')[0]!;
    const familyId = rows.find((r) => r.userId === user.id)!.familyId;
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfTokenFor(familyId));
    expect(refresh.status).toBe(401);
    // another user's sessions are untouched
    expect(await prisma.refreshToken.count({ where: { userId: other.id, revokedAt: null } })).toBe(
      1,
    );
  });

  it('AUTH-03 · an access token issued before the reset is rejected after the reset', async () => {
    await mkUser();
    const before = await login();
    const oldToken = before.body.accessToken as string;
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${oldToken}`)).status,
    ).toBe(200);

    advance(2);
    const code = await requestCode();
    advance(1);
    expect((await reset(EMAIL, code)).status).toBe(200);

    const rejected = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(rejected.status).toBe(401);
    expect(rejected.body.code).toBe('UNAUTHORIZED');

    // the reset does not log in, so a legitimate new token is issued in a later second and works
    advance(1);
    const fresh = await login(EMAIL, NEW);
    expect(fresh.status).toBe(200);
    expect(
      (
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${fresh.body.accessToken as string}`)
      ).status,
    ).toBe(200);
  });

  it('AUTH-03 · an access token issued in the same second as the reset, before it, is rejected', async () => {
    await mkUser();
    // pin the clock 100 ms into a second so everything below stays inside that second
    now = Math.floor(now / 1000) * 1000 + 100;
    vi.setSystemTime(now);
    const oldToken = (await login()).body.accessToken as string;
    advance(0.3);
    const code = await requestCode();
    advance(0.3);
    expect((await reset(EMAIL, code)).status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const iat = (
      JSON.parse(Buffer.from(oldToken.split('.')[1]!, 'base64url').toString()) as { iat: number }
    ).iat;
    expect(iat).toBe(Math.floor(user.passwordChangedAt!.getTime() / 1000)); // same second
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${oldToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('AUTH-03 · a weak new password → 422 and the code stays usable', async () => {
    await mkUser();
    const code = await requestCode();
    for (const newPassword of ['Ab1', 'abcdefghij', '1234567890', 'a1'.repeat(65)]) {
      const res = await reset(EMAIL, code, newPassword);
      expect(res.status, newPassword).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await reset(EMAIL, 'abc123')).status).toBe(422); // malformed code
    expect((await reset(EMAIL, code)).status).toBe(200);
  });

  it('AUTH-03 · a wrong code → 400 OTP_INVALID; the 5th wrong code burns the live code', async () => {
    await mkUser();
    const code = await requestCode();
    for (let i = 0; i < 5; i++) {
      const res = await reset(EMAIL, wrong(code));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const late = await reset(EMAIL, code);
    expect(late.status).toBe(400);
    expect(late.body.code).toBe('OTP_INVALID');
    expect(
      await verifyPassword(
        (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).passwordHash,
        OLD,
      ),
    ).toBe(true);
  });

  it('AUTH-03 · an expired code is rejected with the same 400 OTP_INVALID', async () => {
    await mkUser();
    const code = await requestCode();
    advance(env.OTP_TTL_SECONDS + 1);
    const res = await reset(EMAIL, code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  it('AUTH-03 · a code works once; a second submit is rejected and consumes nothing else', async () => {
    await mkUser();
    const code = await requestCode();
    expect((await reset(EMAIL, code)).status).toBe(200);
    const again = await reset(EMAIL, code, 'Y3tAnotherPw');
    expect(again.status).toBe(400);
    expect(
      await verifyPassword(
        (await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).passwordHash,
        NEW,
      ),
    ).toBe(true);
  });

  it('AUTH-03 · a reset consumes every live RESET_PASSWORD code of the email', async () => {
    await mkUser();
    const first = await requestCode();
    advance(61);
    const second = await requestCode();
    expect((await reset(EMAIL, second)).status).toBe(200);
    const res = await reset(EMAIL, first, 'Y3tAnotherPw');
    expect(res.status).toBe(400);
    expect(
      await prisma.otp.count({
        where: { email: EMAIL, purpose: 'RESET_PASSWORD', consumedAt: null },
      }),
    ).toBe(0);
  });

  it('AUTH-03 · codes of the other purpose do not cross over', async () => {
    await mkUser();
    const verifyCode = await createOtp({ email: EMAIL, purpose: 'VERIFY_EMAIL' });
    expect((await reset(EMAIL, verifyCode)).status).toBe(400);

    const resetCode = await requestCode();
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: EMAIL, code: resetCode });
    expect(res.status).toBe(400);
    expect((await reset(EMAIL, resetCode)).status).toBe(200); // the failed verify did not consume it
  });

  it('AUTH-03 · an unknown email returns the same 400 OTP_INVALID as a wrong code, and every failure path spends an argon2 verify', async () => {
    await mkUser();
    const code = await requestCode();
    const unknown = await reset(UNKNOWN, '123456');
    const badCode = await reset(EMAIL, wrong(code));
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('OTP_INVALID');
    expect(sameError(unknown.body)).toEqual(sameError(badCode.body));
    expect(dummyVerify).toHaveBeenCalledTimes(2);

    // a known account with no live code (never requested / expired) is indistinguishable too
    await mkUser({ email: 'quiet@example.com' });
    const none = await reset('quiet@example.com', '123456');
    expect(sameError(none.body)).toEqual(sameError(unknown.body));
    expect(dummyVerify).toHaveBeenCalledTimes(3);
  });

  it('AUTH-03 · a blocked account gets 403 ACCOUNT_BLOCKED only after a correct code', async () => {
    const user = await mkUser();
    const code = await requestCode();
    await prisma.user.update({ where: { id: user.id }, data: { isBlocked: true } });

    const bad = await reset(EMAIL, wrong(code));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('OTP_INVALID');

    const good = await reset(EMAIL, code);
    expect(good.status).toBe(403);
    expect(good.body.code).toBe('ACCOUNT_BLOCKED');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(after.passwordHash, OLD)).toBe(true);
    expect(after.passwordChangedAt).toBeNull();
  });

  it('AUTH-03 · a reset clears the login lockout (key and counters)', async () => {
    const user = await mkUser();
    for (let i = 0; i < env.LOGIN_MAX_FAILURES; i++) await login(EMAIL, 'Wr0ngPassword');
    const locked = await login();
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).failedLoginCount,
    ).toBeGreaterThan(0);

    expect((await reset(EMAIL, await requestCode())).status).toBe(200);

    expect(
      await prisma.rateLimit.count({
        where: { key: { contains: limitKey('login', 'email', EMAIL) } },
      }),
    ).toBe(0);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect((await login(EMAIL, NEW)).status).toBe(200);
  });

  it('AUTH-03 · two concurrent resets with the same code: exactly one wins', async () => {
    await mkUser();
    const code = await requestCode();
    const [a, b] = await Promise.all([
      reset(EMAIL, code, 'Winner1Password'),
      reset(EMAIL, code, 'Winner2Password'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const loser = a.status === 400 ? a : b;
    expect(loser.body.code).toBe('OTP_INVALID');
    await vi.waitFor(() =>
      expect(mails().filter((m) => /password was changed|تم تغيير/.test(m.subject))).toHaveLength(
        1,
      ),
    );
  });
});

describe('POST /auth/reset-password abuse limits (AUTH-03)', () => {
  it('AUTH-03 · 10 failed attempts from one IP across different emails → 429, even with a correct code', async () => {
    await mkUser();
    const code = await requestCode();
    for (let i = 0; i < 10; i++) {
      const res = await reset(`guess${i}@example.com`, '123456');
      expect(res.status).toBe(400);
    }
    const blocked = await reset(EMAIL, code);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(await prisma.otp.count({ where: { email: EMAIL, consumedAt: null } })).toBe(1);
  });

  it('AUTH-03 · successful resets do not count toward the IP limit', async () => {
    await mkUser();
    for (let i = 0; i < 9; i++) expect((await reset(UNKNOWN, '123456')).status).toBe(400);
    const code = await requestCode();
    expect((await reset(EMAIL, code)).status).toBe(200); // not counted
    expect((await reset(UNKNOWN, '123456')).status).toBe(400); // the 10th failure
    expect((await reset(UNKNOWN, '123456')).status).toBe(429);
  });
});

describe('password-changed notice (AUTH-03)', () => {
  const changedMail = () => mails().find((m) => /password was changed|تم تغيير/.test(m.subject));
  const waitForNotice = () => vi.waitFor(() => expect(changedMail()).toBeDefined());

  it('AUTH-03 · the notice is sent in the user preferredLocale (en and ar) with no code or password', async () => {
    for (const [loc, subject, line] of [
      ['en', /Your .* password was changed/, 'contact support'],
      ['ar', /تم تغيير كلمة المرور/, 'التواصل مع الدعم'],
    ] as const) {
      await wipe();
      sendMail.mockClear();
      await mkUser({ preferredLocale: loc });
      const code = await requestCode();
      // header locale is the opposite one: the notice follows the account, not the request
      const res = await reset(EMAIL, code, NEW, { 'Accept-Language': loc === 'en' ? 'ar' : 'en' });
      expect(res.status).toBe(200);
      await waitForNotice();
      const mail = changedMail()!;
      expect(mail.to).toBe(EMAIL);
      expect(mail.subject, loc).toMatch(subject);
      expect(mail.text).toContain(line);
      expect(mail.html).toContain(loc === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
      for (const body of [mail.text, mail.html, mail.subject]) {
        expect(body).not.toContain(code);
        expect(body).not.toContain(NEW);
        expect(body).not.toMatch(/\b\d{6}\b/);
      }
      advance(3700);
    }
  });

  it('AUTH-03 · no notice is sent when the reset fails', async () => {
    await mkUser();
    const code = await requestCode();
    const before = mailCount();
    expect((await reset(EMAIL, wrong(code))).status).toBe(400);
    expect((await reset(EMAIL, code, 'weak')).status).toBe(422);
    await new Promise((r) => setTimeout(r, 50));
    expect(mailCount()).toBe(before);
  });

  it('AUTH-03 · a failing mail transport does not fail the reset', async () => {
    await mkUser();
    const code = await requestCode();
    sendMail.mockRejectedValueOnce(new Error('smtp down'));
    expect((await reset(EMAIL, code)).status).toBe(200);
  });
});

describe('NFR-04 · reset-password secrets', () => {
  it('NFR-04 · request logs and responses never contain the new password or the code', async () => {
    await mkUser();
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, stream);
    const logged = createApp({ logger });
    const code = await requestCode();
    const res = await reset(EMAIL, code, NEW, { 'X-Request-Id': 'req-reset-1' }, logged);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));

    const out = lines.join('');
    expect(out).toContain('req-reset-1');
    expect(out).toContain('/api/v1/auth/reset-password');
    expect(out).not.toContain(NEW);
    const values = (v: unknown): unknown[] =>
      v && typeof v === 'object' ? Object.values(v).flatMap(values) : [v];
    for (const e of lines.map((l) => JSON.parse(l) as unknown)) {
      expect(values(e)).not.toContain(code);
    }
    expect(JSON.stringify(res.body)).not.toContain(NEW);
    expect(JSON.stringify(res.body)).not.toContain(code);
  });
});
