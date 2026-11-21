import { execSync } from 'node:child_process';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_role_t005',
  );
});

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { JWT_AUDIENCE, JWT_ISSUER, signAccessToken } from '../../src/lib/tokens.js';
import { requireAuth, requireRole } from '../../src/middleware/auth.js';

// Test-only router behind the REAL middleware; production code has no admin stub (T-005).
const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN'));
adminRouter.get('/ping', (req, res) => {
  res.json({ ok: true, userId: req.user!.id });
});
const app = createApp({ extraRouters: [{ path: '/admin', router: adminRouter }] });
const ping = (token?: string) => {
  const r = request(app).get('/api/v1/admin/ping');
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

const secret = getEnv().ACCESS_TOKEN_SECRET;
let hash = '';
const mkUser = (email: string, over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'T',
      lastName: 'User',
      email,
      passwordHash: hash,
      isVerified: true,
      ...over,
    },
  });

/** A token like signAccessToken's but with chosen options, to forge bad ones. */
const forge = (
  userId: string,
  over: {
    secret?: string;
    alg?: jwt.Algorithm;
    iss?: string;
    aud?: string;
    expiresIn?: number;
  } = {},
) =>
  jwt.sign({ role: 'ADMIN' }, over.secret ?? secret, {
    algorithm: over.alg ?? 'HS256',
    subject: userId,
    issuer: over.iss ?? JWT_ISSUER,
    audience: over.aud ?? JWT_AUDIENCE,
    jwtid: 'forged',
    expiresIn: over.expiresIn ?? 900,
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});
beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('AUTH-06 · role-based access', () => {
  it('AUTH-06 · a CUSTOMER token on an admin route returns 403', async () => {
    const c = await mkUser('c@example.com');
    const res = await ping(signAccessToken(c));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('AUTH-06 · an ADMIN token is allowed; no token or a malformed header returns 401', async () => {
    const a = await mkUser('a@example.com', { role: 'ADMIN' });
    const ok = await ping(signAccessToken(a));
    expect(ok.status).toBe(200);
    expect(ok.body.userId).toBe(a.id);
    expect((await ping()).status).toBe(401);
    expect(
      (await request(app).get('/api/v1/admin/ping').set('Authorization', 'Basic abc')).status,
    ).toBe(401);
    expect((await ping('not.a.jwt')).status).toBe(401);
  });

  it("AUTH-06 · a blocked user's still-valid access token is rejected", async () => {
    const u = await mkUser('b@example.com', { role: 'ADMIN' });
    const token = signAccessToken(u);
    expect((await ping(token)).status).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { isBlocked: true } });
    const res = await ping(token);
    expect(res.status).toBe(401);
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it('AUTH-06 · role downgraded in DB takes effect immediately', async () => {
    const u = await mkUser('d@example.com', { role: 'ADMIN' });
    const token = signAccessToken(u); // the token says ADMIN
    expect((await ping(token)).status).toBe(200);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'CUSTOMER' } });
    expect((await ping(token)).status).toBe(403);
    // and an upgrade is honoured too: the DB, not the token, decides
    await prisma.user.update({ where: { id: u.id }, data: { role: 'ADMIN' } });
    expect((await ping(token)).status).toBe(200);
  });

  it('AUTH-06 · a token for a deleted user is rejected', async () => {
    const u = await mkUser('x@example.com', { role: 'ADMIN' });
    const token = signAccessToken(u);
    await prisma.user.delete({ where: { id: u.id } });
    expect((await ping(token)).status).toBe(401);
  });

  it('AUTH-06 · tokens signed with none or another secret are rejected', async () => {
    const u = await mkUser('s@example.com', { role: 'ADMIN' });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
      sub: u.id,
      role: 'ADMIN',
      jti: 'x',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 900,
    })}.`;
    expect((await ping(unsigned)).status).toBe(401);
    expect((await ping(forge(u.id, { secret: 'x'.repeat(48) }))).status).toBe(401);
    expect((await ping(forge(u.id))).status).toBe(200); // the forge helper itself is valid
  });

  it('AUTH-06 · only HS256 is accepted (HS384 with the right secret is rejected)', async () => {
    const u = await mkUser('h@example.com', { role: 'ADMIN' });
    expect((await ping(forge(u.id, { alg: 'HS384' }))).status).toBe(401);
  });

  it('AUTH-06 · wrong issuer, wrong audience and expired tokens are rejected', async () => {
    const u = await mkUser('i@example.com', { role: 'ADMIN' });
    expect((await ping(forge(u.id, { iss: 'someone-else' }))).status).toBe(401);
    expect((await ping(forge(u.id, { aud: 'other-app' }))).status).toBe(401);
    expect((await ping(forge(u.id, { expiresIn: -10 }))).status).toBe(401);
  });

  it('AUTH-06 · production code mounts no admin stub route', async () => {
    const plain = createApp();
    expect((await request(plain).get('/api/v1/admin/ping')).status).toBe(404);
  });

  it('AUTH-06 · an unverified user token is rejected', async () => {
    const u = await mkUser('v@example.com', { isVerified: false });
    expect(
      (
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${signAccessToken(u)}`)
      ).status,
    ).toBe(401);
  });
});
