import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_auth_t108',
  );
});

import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { hashRefreshToken, signAccessToken, UNREVOKED } from '../../src/lib/tokens.js';
import { createApp } from '../../src/app.js';
import { expectNoSecretKeys } from '../helpers/noSecrets.js';

/**
 * T-108 (QA C5, owner 2026-11-25). A signed-in user changes their own password:
 *  - the current password is required and a wrong one counts toward the EXISTING login lockout;
 *  - the new password goes through the shared policy and may not equal the current one;
 *  - every other session is revoked, while this one keeps working with the token that comes back;
 *  - a security email is sent with the time and no secrets, and a mail failure never fails the change.
 */
const app = createApp();
const env = getEnv();
const sendMail = vi.fn().mockResolvedValue({});

const OLD = 'Passw0rdOne!';
const NEW = 'Passw0rdTwo!';
const EMAIL = 'admin@example.com';
let oldHash = '';

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Alharbi',
      email: EMAIL,
      passwordHash: oldHash,
      isVerified: true,
      role: 'ADMIN',
      preferredLocale: 'en',
      ...over,
    },
  });

const login = (password = OLD, email = EMAIL) =>
  request(app).post('/api/v1/auth/login').send({ email, password });

const change = (token: string, body: Record<string, unknown>, cookie?: string) => {
  const r = request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${token}`);
  return (cookie ? r.set('Cookie', cookie) : r).send(body);
};

/** `fx_rt=<token>` from a Set-Cookie header, ready to send back as a Cookie header. */
const cookieOf = (res: request.Response): string => {
  const sc = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = sc.find((s) => s.startsWith('fx_rt='));
  if (!c) throw new Error('no fx_rt cookie');
  return c.split(';')[0]!;
};
const rawOf = (cookie: string) => cookie.slice('fx_rt='.length);
const live = (cookie: string) =>
  prisma.refreshToken.findFirst({
    where: { tokenHash: hashRefreshToken(rawOf(cookie)), ...UNREVOKED },
  });
const csrfFor = async (cookie: string) =>
  (await request(app).get('/api/v1/auth/csrf').set('Cookie', cookie)).body.csrfToken as string;
const lastMail = () =>
  sendMail.mock.calls.at(-1)?.[0] as { to: string; subject: string; text: string; html: string };

async function wipe() {
  await Promise.all([prisma.refreshToken.deleteMany(), prisma.rateLimit.deleteMany()]);
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
  sendMail.mockResolvedValue({});
  setTransport({ sendMail } as never);
});
afterEach(() => setTransport(undefined));
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('POST /auth/change-password (T-108)', () => {
  it('AUTH-03 · changes the password, keeps this session working and revokes the others', async () => {
    const user = await mkUser();
    const here = await login();
    const elsewhere = await login();
    const hereCookie = cookieOf(here);
    const elsewhereCookie = cookieOf(elsewhere);
    const token = here.body.accessToken as string;

    const res = await change(token, { currentPassword: OLD, newPassword: NEW }, hereCookie);
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user.id, email: EMAIL });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expectNoSecretKeys(res.body);

    // The new password is stored, the old one is gone.
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(saved.passwordHash, NEW)).toBe(true);
    expect(await verifyPassword(saved.passwordHash, OLD)).toBe(false);
    expect(saved.passwordChangedAt).toBeInstanceOf(Date);
    expect((await login(NEW)).status).toBe(200);
    expect((await login(OLD)).status).toBe(401);

    // This session keeps working: the returned token is accepted and its cookie is live.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken as string}`);
    expect(me.status).toBe(200);
    const newCookie = cookieOf(res);
    expect(await live(newCookie)).not.toBeNull();
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', newCookie)
          .set({
            'X-CSRF-Token': await csrfFor(newCookie),
          })
      ).status,
    ).toBe(200);

    // The access token this request came with is dead, and so is every other session.
    expect(
      (await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status,
    ).toBe(401);
    expect(await live(elsewhereCookie)).toBeNull();
    expect(await live(hereCookie)).toBeNull();
  });

  it('AUTH-03 · a wrong current password is 401 and counts toward the login lockout', async () => {
    await mkUser();
    const token = signAccessToken(await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } }));
    for (let i = 1; i <= env.LOGIN_MAX_FAILURES; i++) {
      const res = await change(token, { currentPassword: 'Wr0ngPassword!', newPassword: NEW });
      expect(res.status, `attempt ${i}`).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    // The shared counter is full: the next attempt is refused before the password is looked at, and
    // signing in is locked too (one counter per email, owner 2026-11-25).
    const locked = await change(token, { currentPassword: OLD, newPassword: NEW });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.details?.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.headers['retry-after']).toBeTruthy();
    const signIn = await login();
    expect(signIn.status).toBe(429);
    expect(signIn.body.code).toBe('ACCOUNT_LOCKED');
    // Nothing changed: the old password is still the stored one.
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(await verifyPassword(saved.passwordHash, OLD)).toBe(true);
    expect(saved.passwordChangedAt).toBeNull();
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-03 · a successful change clears the failure counter', async () => {
    await mkUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    const token = signAccessToken(user);
    expect((await change(token, { currentPassword: 'Wr0ng!x', newPassword: NEW })).status).toBe(
      401,
    );
    expect((await change(token, { currentPassword: OLD, newPassword: NEW })).status).toBe(200);
    // The counter was reset, so the next sign-in with a wrong password starts from zero.
    const after = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
  });

  it('AUTH-03 · a new password that breaks the policy is 400 with every unmet rule, nothing spent', async () => {
    await mkUser();
    const token = signAccessToken(await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } }));
    const res = await change(token, { currentPassword: OLD, newPassword: 'abcdefghij' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PASSWORD_TOO_WEAK');
    expect(res.body.details).toEqual({ rules: ['upper', 'digit', 'symbol'] });
    // Checked before the current password, so a typo in the new one spends no lockout attempt.
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(saved.failedLoginCount).toBe(0);
    expect(await verifyPassword(saved.passwordHash, OLD)).toBe(true);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-03 · the new password may not be the current one -> 422 SAME_PASSWORD', async () => {
    await mkUser();
    const token = signAccessToken(await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } }));
    const res = await change(token, { currentPassword: OLD, newPassword: OLD });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SAME_PASSWORD');
    const saved = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(saved.passwordChangedAt).toBeNull();
    expect(saved.failedLoginCount).toBe(0); // the current password was right: no failed attempt
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('AUTH-03 · the security email carries the time and no secret', async () => {
    const user = await mkUser();
    const token = signAccessToken(user);
    const res = await change(token, { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = lastMail();
    expect(mail.to).toBe(EMAIL);
    expect(mail.subject).toContain('Furnixa');
    expect(mail.text).toContain('Sara');
    expect(mail.text).toMatch(/\d{1,2}:\d{2}/); // the change time
    expect(mail.text).toContain('Riyadh');
    for (const secret of [OLD, NEW, token, res.body.accessToken as string, oldHash]) {
      expect(mail.text).not.toContain(secret);
      expect(mail.html).not.toContain(secret);
      expect(mail.subject).not.toContain(secret);
    }
    expect(mail.text).not.toMatch(/argon2|passwordHash|fx_rt|Bearer/i);
  });

  it('AUTH-03 · the Arabic admin gets the Arabic email', async () => {
    const user = await mkUser({ preferredLocale: 'ar' });
    const res = await change(signAccessToken(user), { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect(lastMail().html).toContain('dir="rtl"');
    expect(lastMail().text).toContain('مرحباً');
  });

  it('AUTH-03 · a mail that cannot be sent does not fail the change', async () => {
    const user = await mkUser();
    sendMail.mockRejectedValue(new Error('535 Authentication failed'));
    const res = await change(signAccessToken(user), { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(saved.passwordHash, NEW)).toBe(true);
    expect((await login(NEW)).status).toBe(200);
  });

  it('AUTH-03 · a customer may use it too, and gets the customer email', async () => {
    const user = await mkUser({ role: 'CUSTOMER', email: 'customer@example.com' });
    const res = await change(signAccessToken(user), { currentPassword: OLD, newPassword: NEW });
    expect(res.status).toBe(200);
    expect(lastMail().to).toBe('customer@example.com');
    expect(lastMail().subject).not.toContain('admin');
  });

  it('AUTH-03 · unauthenticated and malformed requests are rejected', async () => {
    const user = await mkUser();
    const token = signAccessToken(user);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/change-password')
          .send({ currentPassword: OLD, newPassword: NEW })
      ).status,
    ).toBe(401);
    for (const body of [
      {},
      { currentPassword: OLD },
      { newPassword: NEW },
      { currentPassword: OLD, newPassword: NEW, email: 'x@y.z' },
      { currentPassword: OLD, newPassword: `Aa1!${'x'.repeat(125)}` },
    ]) {
      const res = await change(token, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordChangedAt,
    ).toBeNull();
  });
});
