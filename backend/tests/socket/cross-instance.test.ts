import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_socket_t023a',
  );
});

import type { Socket as ClientSocket } from 'socket.io-client';
import { getEnv } from '../../src/config/env.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { adapterCollection, closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import {
  connectClient,
  connected,
  sleep,
  startSocketServer,
  waitForDisconnect,
  waitForEvent,
  type TestSocketServer,
} from '../helpers/socket.js';

const env = getEnv();
let instanceA: TestSocketServer;
let instanceB: TestSocketServer;
const clients: ClientSocket[] = [];

const mkUser = async (role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') => {
  const user = await prisma.user.create({
    data: {
      firstName: 'Sock',
      lastName: 'Tester',
      email: `${randomUUID()}@example.com`,
      passwordHash: 'x',
      isVerified: true,
      role,
    },
  });
  return { user, token: signAccessToken(user) };
};

/** Connect to one of the two instances and wait for the handshake to finish. */
const join = async (port: number, token: string) => {
  const socket = connectClient(port, token);
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
  // The spike setup (ADR-012): two SEPARATE Socket.IO server instances on the MongoDB adapter,
  // plus the REST-side emitter as a third party. Nothing is shared in memory.
  instanceA = await startSocketServer(env);
  instanceB = await startSocketServer(env);
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
});

afterAll(async () => {
  await instanceA?.close();
  await instanceB?.close();
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('Socket.IO MongoDB adapter + emitter (T-023)', () => {
  it('NOTIF-01 · cross-instance delivery: an emitter event reaches the socket on another instance, and only that user', async () => {
    const { user, token } = await mkUser();
    const other = await mkUser();
    const socket = await join(instanceB.port, token);
    const otherSocket = await join(instanceA.port, other.token);
    const otherReceived: unknown[] = [];
    otherSocket.on('notification:new', (p: unknown) => otherReceived.push(p));

    const payload = { id: 'n1', title: 'Order update', orderId: 'o1' };
    socketEmitter.toUser(user.id).emit('notification:new', payload);

    const received = await waitForEvent(socket, 'notification:new');
    expect(received).toEqual(payload);
    await sleep(300); // give a wrong delivery time to show up
    expect(otherReceived).toEqual([]);
  });

  it('NOTIF-02 · toAdmins reaches an admin socket on another instance; customers are not in the room', async () => {
    const admin = await mkUser('ADMIN');
    const customer = await mkUser();
    const adminSocket = await join(instanceA.port, admin.token);
    const customerSocket = await join(instanceB.port, customer.token);
    const customerReceived: unknown[] = [];
    customerSocket.on('notification:new', (p: unknown) => customerReceived.push(p));

    const payload = { id: 'n2', title: 'New order' };
    socketEmitter.toAdmins().emit('notification:new', payload);

    expect(await waitForEvent(adminSocket, 'notification:new')).toEqual(payload);
    await sleep(300);
    expect(customerReceived).toEqual([]);
  });

  it("NOTIF-01 · disconnectUser closes all of a user's sockets, across instances", async () => {
    const { user, token } = await mkUser();
    const bystander = await mkUser();
    const onA = await join(instanceA.port, token);
    const onB = await join(instanceB.port, token);
    const bystanderSocket = await join(instanceB.port, bystander.token);

    socketEmitter.disconnectUser(user.id);

    await Promise.all([waitForDisconnect(onA), waitForDisconnect(onB)]);
    expect(onA.connected).toBe(false);
    expect(onB.connected).toBe(false);
    await sleep(300);
    expect(bystanderSocket.connected).toBe(true);
  });

  it('NOTIF-03 · adapter documents carry createdAt and the TTL index exists (cron + TTL can sweep them)', async () => {
    const indexes = await adapterCollection().indexes();
    const ttl = indexes.find((i) => i.name === 'createdAt_ttl');
    expect(ttl).toBeDefined();
    expect(ttl!.key).toEqual({ createdAt: 1 });
    expect(ttl!.expireAfterSeconds).toBe(env.SOCKET_ADAPTER_TTL_SECONDS);

    // Both writers stamp createdAt: the adapter (heartbeats/broadcasts) and the emitter.
    socketEmitter.toUser('nobody').emit('notification:new', { id: 'ttl-check' });
    await sleep(300);
    const docs = await adapterCollection().find({}).limit(20).toArray();
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) expect(doc.createdAt).toBeInstanceOf(Date);
  });
});
