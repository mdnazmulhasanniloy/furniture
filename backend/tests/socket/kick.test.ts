import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_socket_t023c',
  );
});

import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { csrfTokenFor } from '../../src/lib/csrf.js';
import { closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { UNREVOKED } from '../../src/lib/tokens.js';
import { createOtp } from '../../src/modules/auth/otp.service.js';
import {
  connectClient,
  connected,
  startSocketServer,
  waitForDisconnect,
  type TestSocketServer,
} from '../helpers/socket.js';

const env = getEnv();
const app = createApp();
let server: TestSocketServer;
const clients: ClientSocket[] = [];
const PASSWORD = 'Passw0rdOld';
let passwordHash = '';

const mkUser = async () =>
  prisma.user.create({
    data: {
      firstName: 'Kick',
      lastName: 'Target',
      email: `${randomUUID()}@example.com`,
      passwordHash,
      isVerified: true,
    },
  });

const fxCookie = (res: { headers: Record<string, unknown> }): string => {
  const cookies = ([] as string[]).concat((res.headers['set-cookie'] as string[]) ?? []);
  const raw = cookies.find((c) => c.startsWith('fx_rt='));
  if (!raw) throw new Error('no fx_rt cookie in response');
  return raw.split(';')[0]!;
};

/** Connect a live socket for the user and wait for the handshake. */
const liveSocket = async (token: string) => {
  const socket = connectClient(server.port, token);
  clients.push(socket);
  await connected(socket);
  return socket;
};

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await ensureSocketIndexes();
  server = await startSocketServer(env);
  passwordHash = await hashPassword(PASSWORD);
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await Promise.all([
    prisma.otp.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.rateLimit.deleteMany(),
  ]);
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await server?.close();
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('session revocation disconnects live sockets (T-023)', () => {
  it("AUTH-03 · a password reset disconnects the user's live sockets", async () => {
    const user = await mkUser();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const socket = await liveSocket(login.body.accessToken as string);

    const code = await createOtp({ email: user.email, purpose: 'RESET_PASSWORD' });
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, code, newPassword: 'Br4ndNewPass9' });
    expect(reset.status).toBe(200);

    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
    // And the sessions are gone too (T-006 behaviour, sanity check).
    const live = await prisma.refreshToken.findMany({
      where: { userId: user.id, ...UNREVOKED },
    });
    expect(live).toEqual([]);
  });

  it("AUTH-05 · refresh-token reuse detection revokes the family and disconnects the user's live sockets", async () => {
    const user = await mkUser();
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const oldCookie = fxCookie(login);
    const { familyId } = await prisma.refreshToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    const csrf = csrfTokenFor(familyId);

    // Rotate once (the old token is now revoked+rotated), then age the rotation past the grace window.
    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .set('X-CSRF-Token', csrf);
    expect(rotated.status).toBe(200);
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, rotatedAt: { not: null } },
      data: { rotatedAt: new Date(Date.now() - 20_000) },
    });

    const socket = await liveSocket(login.body.accessToken as string);

    // Replaying the old cookie after the grace window = assumed theft.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookie)
      .set('X-CSRF-Token', csrf);
    expect(replay.status).toBe(401);

    await waitForDisconnect(socket);
    expect(socket.connected).toBe(false);
    const live = await prisma.refreshToken.findMany({
      where: { familyId, ...UNREVOKED },
    });
    expect(live).toEqual([]);
  });
});
