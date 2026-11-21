import { execSync } from 'node:child_process';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_auth_t004',
  );
});

import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { verifyPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { createApp } from '../../src/app.js';

const app = createApp();
const sendMail = vi.fn().mockResolvedValue({});

const PASSWORD_1 = 'Passw0rdOne';
const PASSWORD_2 = 'Passw0rdTwo';
const EMAIL = 'user@example.com';
const body = (over: Record<string, unknown> = {}) => ({
  firstName: 'Sara',
  lastName: 'Alharbi',
  email: EMAIL,
  password: PASSWORD_1,
  ...over,
});

let now = Date.now();
const advance = (seconds: number) => {
  now += seconds * 1000;
  vi.setSystemTime(now);
};

const register = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  request(app).post('/api/v1/auth/register').set(headers).send(body(over));
const verify = (code: string, email = EMAIL) =>
  request(app).post('/api/v1/auth/verify-otp').send({ email, code });
/** VERIFY_EMAIL resend carries the registration password (T-027); RESET_PASSWORD never does. */
const resend = (
  email = EMAIL,
  purpose = 'VERIFY_EMAIL',
  headers: Record<string, string> = {},
  password: string | undefined = purpose === 'VERIFY_EMAIL' ? PASSWORD_1 : undefined,
) => request(app).post('/api/v1/auth/resend-otp').set(headers).send({ email, purpose, password });

/** Code from the n-th (default: last) sent email. */
const sentCode = (n = -1): string => {
  const call = sendMail.mock.calls.at(n)?.[0] as { text: string };
  const m = /\b(\d{6})\b/.exec(call.text);
  if (!m) throw new Error('no code in email');
  return m[1]!;
};
const lastMail = () =>
  sendMail.mock.calls.at(-1)?.[0] as { to: string; subject: string; text: string; html: string };
/** Error body without the per-request id. */
const sameError = ({ requestId: _id, ...rest }: Record<string, unknown>) => rest;
const wrongCode = (real: string) => (real === '000000' ? '111111' : '000000');

async function wipe() {
  await Promise.all([prisma.otp.deleteMany(), prisma.refreshToken.deleteMany()]);
  await prisma.user.deleteMany();
}

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
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

describe('POST /auth/register (AUTH-01)', () => {
  it('AUTH-01 · register creates an unverified user and emails a 6-digit OTP stored hashed', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.message).toEqual(expect.any(String));

    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user).toMatchObject({
      isVerified: false,
      firstName: 'Sara',
      lastName: 'Alharbi',
      role: 'CUSTOMER',
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);

    const code = sentCode();
    expect(code).toMatch(/^\d{6}$/);
    expect(lastMail().to).toBe(EMAIL);
    const otp = await prisma.otp.findFirstOrThrow({ where: { email: EMAIL } });
    expect(otp.purpose).toBe('VERIFY_EMAIL');
    expect(otp.codeHash).not.toContain(code);
    expect(otp.expiresAt.getTime() - otp.createdAt.getTime()).toBe(getEnv().OTP_TTL_SECONDS * 1000);
  });

  it('AUTH-01 · register without firstName or lastName → 422', async () => {
    const noFirst: Record<string, unknown> = body();
    delete noFirst.firstName;
    const noLast: Record<string, unknown> = body();
    delete noLast.lastName;
    expect((await request(app).post('/api/v1/auth/register').send(noFirst)).status).toBe(422);
    expect((await request(app).post('/api/v1/auth/register').send(noLast)).status).toBe(422);
    expect((await register({ firstName: '   ' })).status).toBe(422);
    expect(await prisma.user.count()).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-01 · password must be 8-128 characters with at least one letter and one number → 422', async () => {
    for (const password of ['Ab1', 'abcdefghij', '1234567890', 'a1'.repeat(65)]) {
      const res = await register({ password });
      expect(res.status, password).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.requestId).toEqual(expect.any(String));
    }
    expect((await register({ password: 'a1'.repeat(64) })).status).toBe(201); // exactly 128
  });

  it('AUTH-01 · "User@Example.COM " and "user@example.com" are the same account', async () => {
    expect((await register({ email: ' User@Example.COM ' })).status).toBe(201);
    advance(61);
    expect((await register({ email: 'user@example.com', firstName: 'Second' })).status).toBe(201);
    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.user.findFirstOrThrow()).email).toBe('user@example.com');

    const verified = await verify(sentCode(), 'USER@example.com  ');
    expect(verified.status).toBe(200);
    expect(verified.body.user.email).toBe('user@example.com');
  });

  it('AUTH-01 · register with an already verified email → 409', async () => {
    await register();
    await verify(sentCode());
    advance(61);
    const res = await register({ password: PASSWORD_2 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'EMAIL_IN_USE', requestId: expect.any(String) });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('AUTH-01 · second register on an unverified email does not change the password; verifying the first OTP logs in with the first password', async () => {
    await register();
    const first = sentCode();
    const before = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    advance(61);
    await register({
      password: PASSWORD_2,
      firstName: 'Mallory',
      lastName: 'Evil',
      preferredLocale: 'en',
    });
    const afterSecond = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(afterSecond.passwordHash).toBe(before.passwordHash);
    expect(afterSecond.firstName).toBe('Sara');

    const res = await verify(first);
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(user.passwordHash, PASSWORD_1)).toBe(true);
    expect(await verifyPassword(user.passwordHash, PASSWORD_2)).toBe(false);
    expect(res.body.user).toMatchObject({
      firstName: 'Sara',
      lastName: 'Alharbi',
      preferredLocale: 'ar',
    });
  });

  it("AUTH-01 · verifying the second OTP applies the second registration's data", async () => {
    await register();
    advance(61);
    await register({
      password: PASSWORD_2,
      firstName: 'Noor',
      lastName: 'Aldosari',
      preferredLocale: 'en',
    });
    const second = sentCode();

    const res = await verify(second);
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(user.passwordHash, PASSWORD_2)).toBe(true);
    expect(await verifyPassword(user.passwordHash, PASSWORD_1)).toBe(false);
    expect(res.body.user).toMatchObject({
      firstName: 'Noor',
      lastName: 'Aldosari',
      preferredLocale: 'en',
    });
  });

  it('AUTH-01 · after verify, all pending VERIFY_EMAIL OTPs are consumed', async () => {
    await register();
    const first = sentCode();
    advance(61);
    await register({ password: PASSWORD_2 });
    const second = sentCode();

    expect((await verify(first)).status).toBe(200);
    const rows = await prisma.otp.findMany({ where: { email: EMAIL, purpose: 'VERIFY_EMAIL' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.consumedAt !== null)).toBe(true);

    const replay = await verify(second);
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('OTP_EXPIRED');
  });

  it('AUTH-01 · the OTP email is sent in the Accept-Language locale, falling back to ar, with an "ignore if you did not request this" line', async () => {
    await register({ email: 'en@example.com' }, { 'Accept-Language': 'en-US,en;q=0.9' });
    const en = lastMail();
    expect(en.subject).toBe('Your Furnixa verification code');
    expect(en.text).toContain('If you did not request this, ignore this email.');

    await register({ email: 'ar@example.com' }, { 'Accept-Language': 'ar-SA' });
    const ar = lastMail();
    expect(ar.subject).toMatch(/[؀-ۿ]/);
    expect(ar.text).toContain('إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.');
    expect(ar.html).toContain('dir="rtl"');

    await register({ email: 'none@example.com' }); // no header
    expect(lastMail().subject).toMatch(/[؀-ۿ]/);
    await register({ email: 'fr@example.com' }, { 'Accept-Language': 'fr-FR,fr;q=0.9' }); // unsupported
    expect(lastMail().subject).toMatch(/[؀-ۿ]/);
  });
});

describe('POST /auth/verify-otp (AUTH-01)', () => {
  it('AUTH-01 · a correct OTP verifies the account and logs in (access token + httpOnly fx_rt cookie, refresh token stored hashed)', async () => {
    await register();
    const res = await verify(sentCode());
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: EMAIL, isVerified: true, role: 'CUSTOMER' });
    expect(res.body.user.passwordHash).toBeUndefined();

    const claims = jwt.verify(res.body.accessToken, getEnv().ACCESS_TOKEN_SECRET) as jwt.JwtPayload;
    expect(claims.sub).toBe(res.body.user.id);
    expect(claims.role).toBe('CUSTOMER');
    expect(claims.exp! - claims.iat!).toBe(getEnv().ACCESS_TOKEN_TTL_SECONDS);

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('fx_rt='),
    )!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/;\s*Secure/i); // AUTH_COOKIE_SECURE is false outside production
    expect(cookie).toMatch(new RegExp(`Max-Age=${getEnv().REFRESH_TOKEN_TTL_SECONDS}`));
    const raw = /^fx_rt=([^;]+)/.exec(cookie)![1]!;

    const tokens = await prisma.refreshToken.findMany({ where: { userId: res.body.user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenHash).not.toBe(raw);
    expect(tokens[0]!.revokedAt).toBeNull();
    expect(tokens[0]!.expiresAt.getTime() - now).toBe(getEnv().REFRESH_TOKEN_TTL_SECONDS * 1000);
  });

  it('AUTH-01 · a wrong code → 400 OTP_INVALID and the account stays unverified', async () => {
    await register();
    const res = await verify(wrongCode(sentCode()));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'OTP_INVALID', requestId: expect.any(String) });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).isVerified).toBe(
      false,
    );
  });

  it('AUTH-01 · a malformed code → 422', async () => {
    await register();
    expect((await verify('12345')).status).toBe(422);
    expect((await verify('abcdef')).status).toBe(422);
  });

  it('AUTH-01 · 5 wrong codes invalidate the OTP; the correct code is then rejected and a new OTP is needed', async () => {
    await register();
    const code = sentCode();
    for (let i = 0; i < 5; i++) {
      const res = await verify(wrongCode(code));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const sixth = await verify(code);
    expect(sixth.status).toBe(400);
    expect(sixth.body.code).toBe('OTP_EXPIRED');

    advance(61);
    expect((await resend()).status).toBe(200);
    expect((await verify(sentCode())).status).toBe(200);
  });

  it('AUTH-01 · wrong codes are counted per email across all its VERIFY_EMAIL OTPs; 5 in total invalidate every one', async () => {
    await register();
    const first = sentCode();
    advance(61);
    await register({ password: PASSWORD_2 });
    const second = sentCode();

    for (let i = 0; i < 3; i++) await verify(wrongCode(first));
    advance(61);
    await resend(); // a new row inherits the 3 attempts already spent
    const third = sentCode();
    await verify(wrongCode(first));
    expect((await verify(wrongCode(first))).body.code).toBe('OTP_INVALID'); // 5th wrong in total

    for (const code of [first, second, third]) {
      const res = await verify(code);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_EXPIRED');
    }
  });

  it('AUTH-01 · the OTP expires after OTP_TTL_SECONDS (default 600)', async () => {
    await register();
    const code = sentCode();
    advance(getEnv().OTP_TTL_SECONDS + 1);
    const res = await verify(code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } })).isVerified).toBe(
      false,
    );
  });

  it('AUTH-01 · the OTP is still valid just before expiry', async () => {
    await register();
    const code = sentCode();
    advance(getEnv().OTP_TTL_SECONDS - 1);
    expect((await verify(code)).status).toBe(200);
  });

  it('AUTH-01 · an unknown email → 400 OTP_EXPIRED (same as a missing OTP)', async () => {
    const res = await verify('123456', 'nobody@example.com');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  it('AUTH-01 · an OTP cannot be used twice', async () => {
    await register();
    const code = sentCode();
    expect((await verify(code)).status).toBe(200);
    const again = await verify(code);
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('OTP_EXPIRED');
  });

  it('AUTH-01 · a blocked account → 403 ACCOUNT_BLOCKED', async () => {
    await register();
    const code = sentCode();
    await prisma.user.update({ where: { email: EMAIL }, data: { isBlocked: true } });
    const res = await verify(code);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
  });
});

describe('POST /auth/resend-otp (AUTH-04)', () => {
  it('AUTH-04 · resend before 60 s → 429 RATE_LIMITED; after 60 s it succeeds', async () => {
    await register();
    advance(59);
    const early = await resend();
    expect(early.status).toBe(429);
    expect(early.body).toMatchObject({ code: 'RATE_LIMITED', requestId: expect.any(String) });
    expect(early.body.details.retryAfterSeconds).toBe(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    advance(1);
    const ok = await resend();
    expect(ok.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('AUTH-04 · more than 5 OTPs in one hour for the same email → 429', async () => {
    await register(); // 1
    for (let i = 0; i < 4; i++) {
      advance(61);
      expect((await resend()).status).toBe(200); // 2..5
    }
    advance(61); // cooldown is over, the hourly cap is not
    const res = await resend();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(sendMail).toHaveBeenCalledTimes(5);

    advance(3600); // the window moves on
    expect((await resend()).status).toBe(200);
  });

  it('AUTH-04 · a resent OTP verifies the account and keeps the registration data', async () => {
    await register({ firstName: 'Layla' });
    advance(61);
    await resend();
    const res = await verify(sentCode());
    expect(res.status).toBe(200);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(user.passwordHash, PASSWORD_1)).toBe(true);
    expect(res.body.user.firstName).toBe('Layla');
  });

  it('AUTH-04 · the response is identical for known and unknown emails and no email is sent for unknown ones', async () => {
    await register();
    advance(61);
    sendMail.mockClear();
    const known = await resend(EMAIL, 'VERIFY_EMAIL', { 'Accept-Language': 'en' });
    expect(sendMail).toHaveBeenCalledTimes(1);

    sendMail.mockClear();
    const unknown = await resend('ghost@example.com', 'VERIFY_EMAIL', { 'Accept-Language': 'en' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);

    const knownReset = await resend(EMAIL, 'RESET_PASSWORD', { 'Accept-Language': 'en' }); // unverified: no reset mail
    const unknownReset = await resend('ghost@example.com', 'RESET_PASSWORD', {
      'Accept-Language': 'en',
    });
    expect(sendMail).not.toHaveBeenCalled();
    expect(unknownReset.status).toBe(knownReset.status);
    expect(unknownReset.body).toEqual(knownReset.body);
  });

  it('AUTH-04 · rate limits apply to unknown emails too, so a 429 does not reveal whether an account exists', async () => {
    expect((await resend('ghost@example.com')).status).toBe(200);
    expect((await resend('ghost@example.com')).status).toBe(429); // cooldown, same as a known email
    for (let i = 0; i < 4; i++) {
      advance(61);
      expect((await resend('ghost@example.com')).status).toBe(200); // rows 2..5
    }
    advance(61);
    expect((await resend('ghost@example.com')).status).toBe(429); // hourly cap, same as a known email
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-04 · a verified account gets a password-reset mail in its own locale', async () => {
    await register({ preferredLocale: 'en' });
    await verify(sentCode());
    advance(61);
    sendMail.mockClear();
    expect((await resend(EMAIL, 'RESET_PASSWORD')).status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(lastMail().subject).toBe('Reset your Furnixa password');
  });

  it("AUTH-01 · resend with the victim's password binds to the victim's registration even after an attacker registered later", async () => {
    await register({ firstName: 'Victim' }); // victim, PASSWORD_1
    advance(61);
    await register({ firstName: 'Attacker', lastName: 'Evil', password: PASSWORD_2 }); // attacker, same email
    advance(61);
    sendMail.mockClear();

    expect((await resend(EMAIL, 'VERIFY_EMAIL', {}, PASSWORD_1)).status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const res = await verify(sentCode());
    expect(res.status).toBe(200);
    expect(res.body.user.firstName).toBe('Victim');
    expect(res.body.user.lastName).toBe('Alharbi');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(user.passwordHash, PASSWORD_1)).toBe(true);
    expect(await verifyPassword(user.passwordHash, PASSWORD_2)).toBe(false);
  });

  it('AUTH-04 · resend with a wrong password returns the identical 200 response and sends no email', async () => {
    await register();
    advance(61);
    sendMail.mockClear();
    const good = await resend(EMAIL, 'VERIFY_EMAIL', { 'Accept-Language': 'en' });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const goodCode = sentCode();

    advance(61);
    sendMail.mockClear();
    const wrong = await resend(EMAIL, 'VERIFY_EMAIL', { 'Accept-Language': 'en' }, 'Wr0ngPassword');
    expect(sendMail).not.toHaveBeenCalled();
    expect(wrong.status).toBe(good.status);
    expect(wrong.body).toEqual(good.body);

    // already verified: same silent outcome
    await verify(goodCode);
    advance(61);
    const verified = await resend(EMAIL, 'VERIFY_EMAIL', { 'Accept-Language': 'en' });
    expect(sendMail).not.toHaveBeenCalled();
    expect(verified.body).toEqual(good.body);
  });

  it('AUTH-04 · VERIFY_EMAIL resend without a password → 422', async () => {
    await register();
    const res = await request(app)
      .post('/api/v1/auth/resend-otp')
      .send({ email: EMAIL, purpose: 'VERIFY_EMAIL' });
    expect(res.status).toBe(422);
  });

  it('AUTH-04 · cooldown and hourly cap still apply to password-matched resend', async () => {
    await register(); // 1
    advance(30);
    const early = await resend(); // right password, inside the cooldown
    expect(early.status).toBe(429);
    expect(early.body.code).toBe('RATE_LIMITED');
    expect(early.body.details.retryAfterSeconds).toBe(30);
    // a wrong password hits the same 429 at the same moment, so the cap does not leak the match
    expect(sameError((await resend(EMAIL, 'VERIFY_EMAIL', {}, 'Wr0ngPassword')).body)).toEqual(
      sameError(early.body),
    );

    advance(31);
    for (let i = 0; i < 4; i++) {
      expect((await resend()).status).toBe(200); // 2..5
      advance(61);
    }
    const capped = await resend();
    expect(capped.status).toBe(429);
    expect(capped.body.details.retryAfterSeconds).toBe(3600);
    expect(sendMail).toHaveBeenCalledTimes(5);
    expect(sameError((await resend(EMAIL, 'VERIFY_EMAIL', {}, 'Wr0ngPassword')).body)).toEqual(
      sameError(capped.body),
    );
  });

  it('AUTH-04 · an invalid purpose → 422', async () => {
    expect((await resend(EMAIL, 'LOGIN')).status).toBe(422);
  });
});
