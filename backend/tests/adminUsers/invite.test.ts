import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_adminusers_t017c',
  );
});

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { hashPassword, verifyPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { createOtp } from '../../src/modules/auth/otp.service.js';
import { expectNoSecretKeys } from '../helpers/noSecrets.js';

const app = createApp();
const env = getEnv();
const sendMail = vi.fn().mockResolvedValue({});
const BASE = '/api/v1/admin/admins';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const INVITEE = 'invitee@example.com';
const NEW_PASSWORD = 'Chosen1Pass';
let hash = '';
let adminToken = '';
let adminId = '';

let now = Date.now();
const advance = (seconds: number) => {
  now += seconds * 1000;
  vi.setSystemTime(now);
};

const invite = (over: Record<string, unknown> = {}, t = adminToken) =>
  request(app)
    .post(BASE)
    .set(auth(t))
    .send({ firstName: 'Omar', lastName: 'Invited', email: INVITEE, ...over });

const accept = (code: string, over: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ email: INVITEE, code, password: NEW_PASSWORD, ...over });

const resend = (id: string) =>
  request(app).post(`${BASE}/${id}/resend-invite`).set(auth(adminToken));

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
  hash = await hashPassword('Passw0rdOne');
});

beforeEach(async () => {
  await wipe();
  sendMail.mockClear();
  setTransport({ sendMail } as never);
  now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  const admin = await prisma.user.create({
    data: {
      firstName: 'Root',
      lastName: 'Admin',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      role: 'ADMIN',
      isVerified: true,
      invitedById: null,
    },
  });
  adminId = admin.id;
  adminToken = signAccessToken(admin);
});

afterEach(() => {
  vi.useRealTimers();
  setTransport(undefined);
});

afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('POST /admin/admins (ADM-11 invite)', () => {
  it('ADM-11 · invite creates an unverified ADMIN without a usable password and emails the code (ar default)', async () => {
    const res = await invite();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: INVITEE,
      role: 'ADMIN',
      isVerified: false,
      isBlocked: false,
      preferredLocale: 'ar',
      invitedById: adminId,
    });
    expectNoSecretKeys(res.body);

    // Email: invitee address, Arabic subject, code + accept link with the email encoded, never the code in the URL.
    const mail = lastMail();
    expect(mail.to).toBe(INVITEE);
    expect(mail.subject).toContain('تمت دعوتك');
    const code = sentCode();
    expect(mail.text).toContain(
      `${env.ADMIN_URL.replace(/\/+$/, '')}/accept-invite?email=${encodeURIComponent(INVITEE)}`,
    );
    expect(mail.text).not.toContain(`code=${code}`);
    // 48 h validity wording (owner change 2: validity is in the email).
    expect(mail.text).toContain('48 ساعة');

    // No usable password: any guess gets the generic 401 (no EMAIL_NOT_VERIFIED leak either).
    for (const password of ['Passw0rdOne', NEW_PASSWORD]) {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: INVITEE, password });
      expect(login.status).toBe(401);
      expect(login.body.code).toBe('INVALID_CREDENTIALS');
    }
  });

  it('ADM-11 · preferredLocale en is stored and the invite email is English', async () => {
    const res = await invite({ preferredLocale: 'en' });
    expect(res.status).toBe(201);
    expect(res.body.preferredLocale).toBe('en');
    const mail = lastMail();
    expect(mail.subject).toContain('You have been invited');
    expect(mail.text).toContain('48 hours');
  });

  it('ADM-11 · any existing email -> 409 EMAIL_IN_USE (verified customer, admin, pending registration)', async () => {
    // Verified customer.
    await prisma.user.create({
      data: {
        firstName: 'C',
        lastName: 'U',
        email: 'customer@example.com',
        passwordHash: hash,
        isVerified: true,
        invitedById: null,
      },
    });
    // Pending (unverified) customer registration through the real route.
    const reg = await request(app).post('/api/v1/auth/register').send({
      firstName: 'Pend',
      lastName: 'Ing',
      email: 'pending@example.com',
      password: 'Passw0rdOne',
    });
    expect(reg.status).toBe(201);

    for (const email of ['customer@example.com', 'pending@example.com']) {
      const res = await invite({ email });
      expect(res.status, email).toBe(409);
      expect(res.body.code).toBe('EMAIL_IN_USE');
    }
    // An existing admin (the inviter) too.
    const self = await invite({
      email: (await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).email,
    });
    expect(self.status).toBe(409);
  });

  it('ADM-11 · validation: missing names, bad email, a password field, customer caller', async () => {
    expect((await invite({ firstName: '' })).status).toBe(422);
    expect((await invite({ email: 'not-an-email' })).status).toBe(422);
    // The invite never carries a password (owner 2026-11-22): strict schema rejects it.
    expect((await invite({ password: 'Sneaky1Pass' })).status).toBe(422);

    const customer = await prisma.user.create({
      data: {
        firstName: 'C',
        lastName: 'U',
        email: `${randomUUID()}@example.com`,
        passwordHash: hash,
        isVerified: true,
        invitedById: null,
      },
    });
    expect((await invite({}, signAccessToken(customer))).status).toBe(403);
  });
});

describe('POST /auth/accept-invite (ADM-11 accept)', () => {
  it('ADM-11 · happy path: sets the chosen password, verifies, logs in with the DB role ADMIN', async () => {
    await invite();
    const res = await accept(sentCode());
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: INVITEE, role: 'ADMIN', isVerified: true });
    expectNoSecretKeys(res.body);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('fx_rt='))).toBe(true);

    // The access token works on an admin route right away.
    const list = await request(app)
      .get(BASE)
      .set(auth(res.body.accessToken as string));
    expect(list.status).toBe(200);
    expectNoSecretKeys(list.body);
    const row = (list.body as { email: string; invitedById: string | null }[]).find(
      (u) => u.email === INVITEE,
    );
    expect(row?.invitedById).toBe(adminId);

    // The chosen password is the stored one; the inviter never saw it.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: INVITEE } });
    expect(await verifyPassword(user.passwordHash, NEW_PASSWORD)).toBe(true);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: INVITEE, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });

  it('ADM-11 · wrong code and unknown email return the identical 400 OTP_INVALID', async () => {
    await invite();
    const code = sentCode();
    const wrong = await accept(wrongCode(code));
    const unknown = await accept(code, { email: 'ghost@example.com' });
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(sameError(wrong.body)).toEqual(sameError(unknown.body));
    expect(wrong.body.code).toBe('OTP_INVALID');
  });

  it('ADM-11 · the 5th wrong code burns the invite (the real code stops working)', async () => {
    await invite();
    const code = sentCode();
    for (let i = 0; i < 5; i += 1) {
      expect((await accept(wrongCode(code))).status).toBe(400);
    }
    const burnt = await accept(code);
    expect(burnt.status).toBe(400);
    expect(burnt.body.code).toBe('OTP_INVALID');
  });

  it('ADM-11 · a weak password -> 422 and the code stays usable', async () => {
    await invite();
    const code = sentCode();
    const weak = await accept(code, { password: 'short' });
    expect(weak.status).toBe(422);
    expect((await accept(code)).status).toBe(200);
  });

  it('ADM-11 · a blocked invitee gets 403 ACCOUNT_BLOCKED only after a correct code', async () => {
    await invite();
    const code = sentCode();
    await prisma.user.update({ where: { email: INVITEE }, data: { isBlocked: true } });
    const wrong = await accept(wrongCode(code));
    expect(wrong.status).toBe(400); // a wrong code never reveals the blocked status
    const correct = await accept(code);
    expect(correct.status).toBe(403);
    expect(correct.body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('ADM-11 · the invite outlives OTP_TTL_SECONDS but expires after INVITE_TTL_SECONDS', async () => {
    await invite();
    const code = sentCode();
    // Past the ordinary OTP TTL (10 min): the 48 h invite still works... (checked at the end to keep the code live)
    advance(env.OTP_TTL_SECONDS + 1);
    const otp = await prisma.otp.findFirstOrThrow({ where: { email: INVITEE } });
    expect(otp.expiresAt.getTime()).toBeGreaterThan(now);

    // ...but not past INVITE_TTL_SECONDS.
    advance(env.INVITE_TTL_SECONDS);
    const expired = await accept(code);
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('OTP_INVALID');
  });
});

describe('POST /admin/admins/{id}/resend-invite (ADM-11)', () => {
  it('ADM-11 · resend invalidates the old code; the new one works; cooldown applies', async () => {
    await invite();
    const oldCode = sentCode();
    const { id } = await prisma.user.findUniqueOrThrow({ where: { email: INVITEE } });

    // Inside the 60 s cooldown -> 429 (same T-004 limits).
    const tooSoon = await resend(id);
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe('RATE_LIMITED');

    advance(61);
    const ok = await resend(id);
    expect(ok.status).toBe(200);
    const newCode = sentCode();

    const stale = await accept(oldCode);
    expect(stale.status).toBe(400);
    expect(stale.body.code).toBe('OTP_INVALID');
    expect((await accept(newCode)).status).toBe(200);
  });

  it('ADM-11 · resend after acceptance -> 409 ALREADY_VERIFIED; customer or malformed id -> 404', async () => {
    await invite();
    const { id } = await prisma.user.findUniqueOrThrow({ where: { email: INVITEE } });
    expect((await accept(sentCode())).status).toBe(200);
    const after = await resend(id);
    expect(after.status).toBe(409);
    expect(after.body.code).toBe('ALREADY_VERIFIED');

    const customer = await prisma.user.create({
      data: {
        firstName: 'C',
        lastName: 'U',
        email: `${randomUUID()}@example.com`,
        passwordHash: hash,
        isVerified: true,
        invitedById: null,
      },
    });
    expect((await resend(customer.id)).status).toBe(404);
    expect((await resend('not-an-id')).status).toBe(404);
  });
});

describe('takeover guards (ADM-11 / AUTH-01)', () => {
  it('ADM-11 · registering the email of a pending admin invite returns 409 and sends no code', async () => {
    await invite();
    const sentBefore = sendMail.mock.calls.length;
    const reg = await request(app).post('/api/v1/auth/register').send({
      firstName: 'Att',
      lastName: 'Acker',
      email: INVITEE,
      password: 'Attack3rPass',
    });
    expect(reg.status).toBe(409);
    expect(reg.body.code).toBe('EMAIL_IN_USE');
    expect(sendMail.mock.calls.length).toBe(sentBefore);
  });

  it('ADM-11 · a VERIFY_EMAIL code can never accept an invite', async () => {
    await invite();
    // Even a VERIFY_EMAIL row for the same email (crafted directly) must not pass the INVITE_ADMIN match.
    const verifyCode = await createOtp({ email: INVITEE, purpose: 'VERIFY_EMAIL' });
    const res = await accept(verifyCode);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');
    expect((await prisma.user.findUniqueOrThrow({ where: { email: INVITEE } })).isVerified).toBe(
      false,
    );
  });

  it('ADM-11 · an INVITE_ADMIN code can never pass /auth/verify-otp', async () => {
    await invite();
    const inviteCode = sentCode();
    const res = await request(app)
      .post('/api/v1/auth/verify-otp')
      .send({ email: INVITEE, code: inviteCode });
    expect(res.status).toBe(400);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: INVITEE } });
    expect(user.isVerified).toBe(false);
    // And the invite code itself still works where it belongs.
    expect((await accept(inviteCode)).status).toBe(200);
  });
});
