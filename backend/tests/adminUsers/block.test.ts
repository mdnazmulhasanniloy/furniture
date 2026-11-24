import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_adminusers_t017b',
  );
});

import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { csrfTokenFor } from '../../src/lib/csrf.js';
import { closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken, UNREVOKED } from '../../src/lib/tokens.js';
import { blockAdmin, testHooks } from '../../src/modules/adminUsers/service.js';
import {
  connectClient,
  connected,
  startSocketServer,
  waitForDisconnect,
  type TestSocketServer,
} from '../helpers/socket.js';

const env = getEnv();
const app = createApp();
const PASSWORD = 'Passw0rdOne';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let server: TestSocketServer;
const clients: ClientSocket[] = [];
let hash = '';

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Block',
      lastName: 'Target',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      isVerified: true,
      invitedById: null,
      ...over,
    },
  });

const login = (email: string) =>
  request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });

const fxCookie = (res: { headers: Record<string, unknown> }): string => {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? []);
  const raw = cookies.find((c) => c.startsWith('fx_rt='));
  if (!raw) throw new Error('no fx_rt cookie in response');
  return raw.split(';')[0]!;
};

const liveSocket = async (token: string) => {
  const socket = connectClient(server.port, token);
  clients.push(socket);
  await connected(socket);
  return socket;
};

const blockCustomer = (adminToken: string, id: string, isBlocked = true) =>
  request(app)
    .patch(`/api/v1/admin/customers/${id}/block`)
    .set(auth(adminToken))
    // CR-011 (ADM-17): blocking a customer needs a reason
    .send(isBlocked ? { isBlocked, reason: 'Blocked by the test suite' } : { isBlocked });

const blockAdminReq = (adminToken: string, id: string, isBlocked = true) =>
  request(app).patch(`/api/v1/admin/admins/${id}/block`).set(auth(adminToken)).send({ isBlocked });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await ensureSocketIndexes();
  server = await startSocketServer(env);
  hash = await hashPassword(PASSWORD);
});

afterEach(async () => {
  delete testHooks.beforeAdminBlockGuard;
  for (const socket of clients.splice(0)) socket.disconnect();
  await Promise.all([
    prisma.refreshToken.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.counter.deleteMany(),
  ]);
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await server?.close();
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('PATCH /admin/customers/{id}/block (ADM-05)', () => {
  it('ADM-05 · block revokes every refresh token and rejects the still-valid access token', async () => {
    const admin = await mkUser({ role: 'ADMIN' });
    const customer = await mkUser();
    const session = await login(customer.email);
    expect(session.status).toBe(200);
    const accessToken = session.body.accessToken as string;
    const cookie = fxCookie(session);
    const { familyId } = await prisma.refreshToken.findFirstOrThrow({
      where: { userId: customer.id },
    });

    const res = await blockCustomer(signAccessToken(admin), customer.id);
    expect(res.status).toBe(200);
    expect(res.body.isBlocked).toBe(true);

    // Every refresh token is revoked (refresh with the pre-block cookie -> 401).
    const live = await prisma.refreshToken.findMany({
      where: { userId: customer.id, ...UNREVOKED },
    });
    expect(live).toEqual([]);
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfTokenFor(familyId));
    expect(refresh.status).toBe(401);

    // The still-valid access token is rejected by requireAuth (T-005 rule).
    const me = await request(app).get('/api/v1/auth/me').set(auth(accessToken));
    expect(me.status).toBe(401);
  });

  it("ADM-05 · block disconnects the customer's live socket", async () => {
    const admin = await mkUser({ role: 'ADMIN' });
    const customer = await mkUser();
    const session = await login(customer.email);
    const socket = await liveSocket(session.body.accessToken as string);

    const res = await blockCustomer(signAccessToken(admin), customer.id);
    expect(res.status).toBe(200);
    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
  });

  it('ADM-05 · a blocked customer cannot log in (403 ACCOUNT_BLOCKED); unblock restores login', async () => {
    const admin = await mkUser({ role: 'ADMIN' });
    const customer = await mkUser();
    const adminToken = signAccessToken(admin);

    expect((await blockCustomer(adminToken, customer.id)).status).toBe(200);
    const blocked = await login(customer.email);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('ACCOUNT_BLOCKED');

    const unblock = await blockCustomer(adminToken, customer.id, false);
    expect(unblock.status).toBe(200);
    expect(unblock.body.isBlocked).toBe(false);
    expect((await login(customer.email)).status).toBe(200);
  });

  it('ADM-05 · an ADMIN id at the customers route -> 404; blocking twice is idempotent', async () => {
    const admin = await mkUser({ role: 'ADMIN' });
    const other = await mkUser({ role: 'ADMIN' });
    const customer = await mkUser();
    const adminToken = signAccessToken(admin);

    const adminTarget = await blockCustomer(adminToken, other.id);
    expect(adminTarget.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).isBlocked).toBe(
      false,
    );

    expect((await blockCustomer(adminToken, customer.id)).status).toBe(200);
    const again = await blockCustomer(adminToken, customer.id);
    expect(again.status).toBe(200);
    expect(again.body.isBlocked).toBe(true);
  });
});

describe('PATCH /admin/admins/{id}/block (ADM-11)', () => {
  it('ADM-11 · an admin blocks another admin: sessions revoked, socket kicked, access token rejected', async () => {
    const actor = await mkUser({ role: 'ADMIN' });
    await mkUser({ role: 'ADMIN' }); // a third active admin keeps LAST_ADMIN out of the way
    const target = await mkUser({ role: 'ADMIN' });
    const session = await login(target.email);
    const socket = await liveSocket(session.body.accessToken as string);

    const res = await blockAdminReq(signAccessToken(actor), target.id);
    expect(res.status).toBe(200);
    expect(res.body.isBlocked).toBe(true);

    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
    expect(
      await prisma.refreshToken.findMany({ where: { userId: target.id, ...UNREVOKED } }),
    ).toEqual([]);
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set(auth(session.body.accessToken as string));
    expect(me.status).toBe(401);
  });

  it('ADM-11 · an admin cannot block themselves -> 422 SELF_BLOCK, nothing changed', async () => {
    const actor = await mkUser({ role: 'ADMIN' });
    await mkUser({ role: 'ADMIN' }); // another active admin exists, so only the self guard can fire
    const res = await blockAdminReq(signAccessToken(actor), actor.id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('SELF_BLOCK');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).isBlocked).toBe(
      false,
    );
  });

  it('ADM-11 · blocking the last active verified admin -> 409 LAST_ADMIN', async () => {
    // Service-level: the actor's own row was blocked concurrently (the API race's losing half),
    // so the target is the last active verified admin left.
    const actor = await mkUser({ role: 'ADMIN', isBlocked: true });
    const target = await mkUser({ role: 'ADMIN' });
    await mkUser({ role: 'ADMIN', isVerified: false }); // a pending invite does not count as active

    await expect(blockAdmin(actor, target.id, true)).rejects.toMatchObject({
      status: 409,
      code: 'LAST_ADMIN',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isBlocked).toBe(
      false,
    );
  });

  it('ADM-11 · two concurrent blocks of the two last admins -> exactly one succeeds (serialized guard)', async () => {
    const adminA = await mkUser({ role: 'ADMIN', firstName: 'A' });
    const adminB = await mkUser({ role: 'ADMIN', firstName: 'B' });

    // Barrier: both transactions must be open at the point just before the serializer write,
    // so each one's snapshot still shows the other admin as active.
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    testHooks.beforeAdminBlockGuard = async (attempt: number) => {
      if (attempt > 1) return; // retries run against committed state, no need to hold them
      entered += 1;
      if (entered === 2) release();
      await barrier;
    };

    const [aBlocksB, bBlocksA] = await Promise.all([
      blockAdminReq(signAccessToken(adminA), adminB.id),
      blockAdminReq(signAccessToken(adminB), adminA.id),
    ]);

    const statuses = [aBlocksB.status, bBlocksA.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = aBlocksB.status === 409 ? aBlocksB : bBlocksA;
    expect(loser.body.code).toBe('LAST_ADMIN');

    // Exactly one admin is blocked; the store keeps an active verified admin.
    const active = await prisma.user.count({
      where: { role: 'ADMIN', isVerified: true, isBlocked: false },
    });
    expect(active).toBe(1);
  });

  it('ADM-11 · a CUSTOMER id at the admins route -> 404', async () => {
    const actor = await mkUser({ role: 'ADMIN' });
    await mkUser({ role: 'ADMIN' });
    const customer = await mkUser();
    const res = await blockAdminReq(signAccessToken(actor), customer.id);
    expect(res.status).toBe(404);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: customer.id } })).isBlocked).toBe(
      false,
    );
  });
});
