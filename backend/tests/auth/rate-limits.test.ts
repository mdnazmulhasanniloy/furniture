import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_auth_ratelimits_t019',
  );
});

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';

/**
 * T-019 (NFR-01): per-IP limits on the auth routes that previously had only per-email caps —
 * register 20/h, verify-otp 10 failed/15 min, resend-otp 20/h, forgot-password 20/h,
 * refresh 20 failed/15 min (successes and 401 REFRESH_RACE are not counted).
 * TRUST_PROXY=1 so each test varies the client IP via X-Forwarded-For.
 */

const app = createApp({ env: { ...getEnv(), TRUST_PROXY: 1 } });
const sendMail = vi.fn().mockResolvedValue({});
const PASSWORD = 'Passw0rdOne!';

const post = (path: string, ip: string, body?: unknown) => {
  const r = request(app).post(`/api/v1/auth/${path}`).set('X-Forwarded-For', ip);
  return body === undefined ? r : r.send(body as object);
};

const expectRateLimited = (res: request.Response) => {
  expect(res.status).toBe(429);
  expect(res.body).toMatchObject({ code: 'RATE_LIMITED' });
  expect(res.headers['retry-after']).toBeDefined();
};

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  setTransport({ sendMail } as never);
  await prisma.rateLimit.deleteMany();
});

afterAll(async () => {
  setTransport(undefined);
  await prisma.$disconnect();
});

/** 6-digit code from the last sent email. */
const sentCode = (): string => {
  const mail = sendMail.mock.calls.at(-1)?.[0] as { text: string } | undefined;
  const m = mail && /\b(\d{6})\b/.exec(mail.text);
  if (!m) throw new Error('no code in email');
  return m[1]!;
};

const registerBody = (email: string) => ({
  firstName: 'Rate',
  lastName: 'Limit',
  email,
  password: PASSWORD,
});

describe('NFR-01 · per-IP rate limits on auth routes (T-019)', () => {
  it('NFR-01 · register is IP rate-limited; another IP is unaffected', async () => {
    const ip = '203.0.113.10';
    for (let i = 1; i <= 20; i++) {
      const res = await post('register', ip, registerBody(`reg-${i}@example.com`));
      expect(res.status, `register #${i}: ${res.text}`).toBe(201);
    }
    expectRateLimited(await post('register', ip, registerBody('reg-21@example.com')));
    const other = await post('register', '203.0.113.11', registerBody('reg-22@example.com'));
    expect(other.status).toBe(201);
  });

  it('NFR-01 · verify-otp failures are IP rate-limited across emails; successes are not counted', async () => {
    const ip = '203.0.113.20';
    // A successful verification first: with `skipSuccessful` its hit is refunded, so the 10
    // failures below still fit the budget; if it counted, failure #10 would already be a 429.
    await post('register', '203.0.113.21', registerBody('verify-ok@example.com')).expect(201);
    await post('verify-otp', ip, { email: 'verify-ok@example.com', code: sentCode() }).expect(200);
    for (let i = 1; i <= 10; i++) {
      const res = await post('verify-otp', ip, {
        email: `verify-miss-${i}@example.com`, // a different email every time: per-email burns never trip
        code: '000000',
      });
      expect(res.status, `failure #${i}: ${res.text}`).toBe(400);
    }
    expectRateLimited(
      await post('verify-otp', ip, { email: 'verify-miss-11@example.com', code: '000000' }),
    );
    const other = await post('verify-otp', '203.0.113.22', {
      email: 'verify-miss-12@example.com',
      code: '000000',
    });
    expect(other.status).toBe(400);
  });

  it('NFR-01 · resend-otp is IP rate-limited across different emails', async () => {
    const ip = '203.0.113.30';
    for (let i = 1; i <= 20; i++) {
      const res = await post('resend-otp', ip, {
        email: `resend-${i}@example.com`, // unknown emails: the per-email cooldown never trips
        purpose: 'RESET_PASSWORD',
      });
      expect(res.status, `resend #${i}: ${res.text}`).toBe(200);
    }
    expectRateLimited(
      await post('resend-otp', ip, { email: 'resend-21@example.com', purpose: 'RESET_PASSWORD' }),
    );
    const other = await post('resend-otp', '203.0.113.31', {
      email: 'resend-22@example.com',
      purpose: 'RESET_PASSWORD',
    });
    expect(other.status).toBe(200);
  });

  it('NFR-01 · forgot-password is IP rate-limited across different emails', async () => {
    const ip = '203.0.113.40';
    for (let i = 1; i <= 20; i++) {
      const res = await post('forgot-password', ip, { email: `forgot-${i}@example.com` });
      expect(res.status, `forgot #${i}: ${res.text}`).toBe(200);
    }
    expectRateLimited(await post('forgot-password', ip, { email: 'forgot-21@example.com' }));
    const other = await post('forgot-password', '203.0.113.41', {
      email: 'forgot-22@example.com',
    });
    expect(other.status).toBe(200);
  });

  it('NFR-01 · refresh failures are IP rate-limited; a valid refresh is not counted', async () => {
    const ip = '203.0.113.50';
    const user = await prisma.user.create({
      data: {
        firstName: 'Refresh',
        lastName: 'User',
        email: 'refresh-limit@example.com',
        passwordHash: await hashPassword(PASSWORD),
        isVerified: true,
      },
    });
    const login = await post('login', ip, { email: user.email, password: PASSWORD }).expect(200);
    const cookie = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('fx_rt='))!
      .split(';')[0]!;
    const csrf = (
      await request(app).get('/api/v1/auth/csrf').set('X-Forwarded-For', ip).set('Cookie', cookie)
    ).body as { csrfToken: string };
    // A successful refresh first: refunded, so the 20 failures below still fit the budget.
    const refreshed = await post('refresh', ip)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrf.csrfToken);
    expect(refreshed.status).toBe(200);
    for (let i = 1; i <= 20; i++) {
      // No cookie at all = a real failure (401 UNAUTHORIZED), the guessing shape the limit targets.
      const res = await post('refresh', ip);
      expect(res.status, `failure #${i}: ${res.text}`).toBe(401);
      expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    }
    expectRateLimited(await post('refresh', ip));
    expect((await post('refresh', '203.0.113.51')).status).toBe(401);
  });

  it('NFR-01 · REFRESH_RACE responses do not count toward the refresh IP limit', async () => {
    const ip = '203.0.113.60';
    const user = await prisma.user.create({
      data: {
        firstName: 'Race',
        lastName: 'User',
        email: 'refresh-race@example.com',
        passwordHash: await hashPassword(PASSWORD),
        isVerified: true,
      },
    });
    const login = await post('login', ip, { email: user.email, password: PASSWORD }).expect(200);
    const oldCookie = ([] as string[])
      .concat(login.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('fx_rt='))!
      .split(';')[0]!;
    const csrfToken = (
      (
        await request(app)
          .get('/api/v1/auth/csrf')
          .set('X-Forwarded-For', ip)
          .set('Cookie', oldCookie)
      ).body as { csrfToken: string }
    ).csrfToken;
    // Rotate once; the old cookie now triggers the 10 s REFRESH_RACE grace path on every retry.
    const rotated = await post('refresh', ip)
      .set('Cookie', oldCookie)
      .set('X-CSRF-Token', csrfToken);
    expect(rotated.status).toBe(200);
    const newCookie = ([] as string[])
      .concat(rotated.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('fx_rt='))!
      .split(';')[0]!;
    // 25 REFRESH_RACE responses — more than the whole 20-failure budget.
    for (let i = 1; i <= 25; i++) {
      const res = await post('refresh', ip).set('Cookie', oldCookie).set('X-CSRF-Token', csrfToken);
      expect(res.status, `race #${i}: ${res.text}`).toBe(401);
      expect(res.body).toMatchObject({ code: 'REFRESH_RACE' });
    }
    // The multi-tab client retries with the new cookie: must be a 200, not a 429 — the races were refunded.
    const retry = await post('refresh', ip).set('Cookie', newCookie).set('X-CSRF-Token', csrfToken);
    expect(retry.status, retry.text).toBe(200);
  });
});
