import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_socket_t023b',
  );
});

import jwt from 'jsonwebtoken';
import type { Socket as ClientSocket } from 'socket.io-client';
import { getEnv } from '../../src/config/env.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { prisma } from '../../src/lib/prisma.js';
import { hit, limitKey } from '../../src/lib/rateLimit.js';
import { SOCKET_CONNECT_LIMIT } from '../../src/lib/socketServer.js';
import { JWT_AUDIENCE, JWT_ISSUER, signAccessToken } from '../../src/lib/tokens.js';
import {
  connectClient,
  connected,
  connectError,
  sleep,
  startSocketServer,
  waitForDisconnect,
  waitForEvent,
  type TestSocketServer,
} from '../helpers/socket.js';

const env = getEnv();
let server: TestSocketServer;
const clients: ClientSocket[] = [];

const track = (socket: ClientSocket) => {
  clients.push(socket);
  return socket;
};

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sock',
      lastName: 'Auth',
      email: `${randomUUID()}@example.com`,
      passwordHash: 'x',
      isVerified: true,
      ...over,
    },
  });

/** A structurally valid token signed outside `signAccessToken` (own secret / ttl / role claim). */
const craftToken = (
  sub: string,
  { secret = env.ACCESS_TOKEN_SECRET, expiresIn = 900, role = 'CUSTOMER' } = {},
) =>
  jwt.sign({ role }, secret, {
    algorithm: 'HS256',
    subject: sub,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    jwtid: randomUUID(),
    expiresIn,
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await ensureSocketIndexes();
  server = await startSocketServer(env);
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await server?.close();
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('socket auth = HTTP auth (T-023)', () => {
  it('NOTIF-01 · a missing, malformed or wrongly-signed token is rejected with unauthorized', async () => {
    const user = await mkUser();
    await expect(connectError(track(connectClient(server.port)))).resolves.toBe('unauthorized');
    await expect(connectError(track(connectClient(server.port, 'not-a-jwt')))).resolves.toBe(
      'unauthorized',
    );
    const wrongSecret = craftToken(user.id, { secret: 'x'.repeat(32) });
    await expect(connectError(track(connectClient(server.port, wrongSecret)))).resolves.toBe(
      'unauthorized',
    );
  });

  it('NOTIF-01 · an expired access token is rejected with unauthorized', async () => {
    const user = await mkUser();
    const expired = craftToken(user.id, { expiresIn: -10 });
    await expect(connectError(track(connectClient(server.port, expired)))).resolves.toBe(
      'unauthorized',
    );
  });

  it("NOTIF-01 · a blocked user's valid token is rejected (and an unverified user's too)", async () => {
    const blocked = await mkUser({ isBlocked: true });
    await expect(
      connectError(track(connectClient(server.port, signAccessToken(blocked)))),
    ).resolves.toBe('unauthorized');
    const unverified = await mkUser({ isVerified: false });
    await expect(
      connectError(track(connectClient(server.port, signAccessToken(unverified)))),
    ).resolves.toBe('unauthorized');
  });

  it('NOTIF-01 · a token issued before a password reset is rejected', async () => {
    const user = await mkUser();
    const token = signAccessToken(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordChangedAt: new Date(Date.now() + 5000) },
    });
    await expect(connectError(track(connectClient(server.port, token)))).resolves.toBe(
      'unauthorized',
    );
  });

  it('NOTIF-01 · a role downgraded in the DB does not join admins (role comes from the DB, not the token)', async () => {
    const user = await mkUser(); // CUSTOMER in the DB
    const adminClaimToken = craftToken(user.id, { role: 'ADMIN' }); // stale/forged role claim
    const socket = track(connectClient(server.port, adminClaimToken));
    await connected(socket);

    const adminEvents: unknown[] = [];
    socket.on('notification:new', (p: unknown) => adminEvents.push(p));
    socketEmitter.toAdmins().emit('notification:new', { id: 'admins-only' });
    await sleep(400);
    expect(adminEvents).toEqual([]); // not in the admins room

    socketEmitter.toUser(user.id).emit('notification:new', { id: 'mine' });
    expect(await waitForEvent(socket, 'notification:new')).toEqual({ id: 'mine' });
  });

  it('NOTIF-01 · the socket is disconnected when its access token expires', async () => {
    const user = await mkUser();
    const shortLived = craftToken(user.id, { expiresIn: 2 });
    const socket = track(connectClient(server.port, shortLived));
    await connected(socket);
    const reason = await waitForDisconnect(socket, 6000);
    expect(reason).toBe('io server disconnect');
  });

  it('NOTIF-01 · a 30-day access token keeps the socket up (expiry timer re-armed, not overflowed)', async () => {
    const user = await mkUser();
    // 2_592_000_000 ms is past Node's 32-bit timer ceiling, which Node clamps to 1 ms. Before the
    // re-arming fix that disconnected the socket on connect and took every socket test with it.
    const longLived = craftToken(user.id, { expiresIn: 2_592_000 });
    const warnings: string[] = [];
    const onWarning = (w: Error) => warnings.push(w.name);
    process.on('warning', onWarning);
    try {
      const socket = track(connectClient(server.port, longLived));
      await connected(socket);
      await sleep(400);
      expect(socket.connected).toBe(true);

      // Still a working member of its own room, not just nominally connected.
      socketEmitter.toUser(user.id).emit('notification:new', { id: 'long-lived' });
      expect(await waitForEvent(socket, 'notification:new')).toEqual({ id: 'long-lived' });
    } finally {
      process.off('warning', onWarning);
    }
    expect(warnings).not.toContain('TimeoutOverflowWarning');
  });
});

describe('socket abuse limits (T-023)', () => {
  it('NFR-01 · connection attempts per IP are limited through the shared store (over the limit → rate_limited)', async () => {
    const user = await mkUser();
    const key = limitKey('socket', 'ip', '127.0.0.1');
    // A successful connect counts one hit (attempts are counted before auth).
    const socket = track(connectClient(server.port, signAccessToken(user)));
    await connected(socket);
    const row = await prisma.rateLimit.findUnique({ where: { key: `rl:${key}` } });
    expect(row?.hits).toBe(1);

    // Exhaust the rest of the window on the same shared counter, then one more attempt.
    for (let i = row!.hits; i < SOCKET_CONNECT_LIMIT; i++) await hit(key, SOCKET_CONNECT_LIMIT, 60);
    await expect(
      connectError(track(connectClient(server.port, signAccessToken(user)))),
    ).resolves.toBe('rate_limited');
    expect(socket.connected).toBe(true); // already-open sockets stay up
  });

  it('NFR-01 · with TRUST_PROXY the forwarded IP is used for the socket limit', async () => {
    const proxied = await startSocketServer({ ...env, TRUST_PROXY: 1 });
    try {
      const user = await mkUser();
      const socket = track(
        connectClient(proxied.port, signAccessToken(user), {
          extraHeaders: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        }),
      );
      await connected(socket);
      const row = await prisma.rateLimit.findUnique({
        where: { key: 'rl:socket:ip:203.0.113.9' },
      });
      expect(row?.hits).toBe(1);
    } finally {
      await proxied.close();
    }
  });

  it('NOTIF-01 · a client emit is ignored (no server handlers) and does not crash the connection', async () => {
    const user = await mkUser();
    const socket = track(connectClient(server.port, signAccessToken(user)));
    await connected(socket);

    socket.emit('notification:new', { forged: true });
    socket.emit('order:updated', { id: 'x', status: 'DELIVERED' });
    socket.emit('disconnect-me-please');
    await sleep(400);
    expect(socket.connected).toBe(true);

    // The server is still healthy and delivering.
    socketEmitter.toUser(user.id).emit('notification:new', { id: 'still-alive' });
    expect(await waitForEvent(socket, 'notification:new')).toEqual({ id: 'still-alive' });
  });

  it('NOTIF-01 · a message over maxHttpBufferSize (10 KB) closes the connection', async () => {
    const user = await mkUser();
    const socket = track(connectClient(server.port, signAccessToken(user)));
    await connected(socket);
    socket.emit('flood', 'x'.repeat(20_000));
    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
  });

  it('NOTIF-01 · a browser Origin must be allow-listed; no Origin (non-browser) is allowed', async () => {
    const guarded = await startSocketServer({
      ...env,
      CORS_ALLOWED_ORIGINS: ['http://localhost:3100'],
    });
    try {
      const user = await mkUser();
      const evil = track(
        connectClient(guarded.port, signAccessToken(user), {
          extraHeaders: { origin: 'https://evil.example' },
        }),
      );
      await expect(connected(evil)).rejects.toBeTruthy(); // upgrade refused before auth
      const allowed = track(
        connectClient(guarded.port, signAccessToken(user), {
          extraHeaders: { origin: 'http://localhost:3100' },
        }),
      );
      await connected(allowed);
      const headless = track(connectClient(guarded.port, signAccessToken(user)));
      await connected(headless);
    } finally {
      await guarded.close();
    }
  });
});
