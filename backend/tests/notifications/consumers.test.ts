import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_notifications_t016',
  );
});

import type { Prisma, User } from '@prisma/client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { createLogger } from '../../src/lib/logger.js';
import { closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import type { NotificationResponse } from '../../src/modules/notifications/service.js';
import {
  connectClient,
  connected,
  sleep,
  startSocketServer,
  waitForEvent,
  type TestSocketServer,
} from '../helpers/socket.js';

const env = getEnv();
const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let server: TestSocketServer;
const clients: ClientSocket[] = [];
let seq = 0;
let categoryId = '';
let admin: User;
let adminToken = '';

const join = async (token: string) => {
  const socket = connectClient(server.port, token);
  clients.push(socket);
  await connected(socket);
  return socket;
};

const mkUser = (role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER', isBlocked = false) => {
  seq += 1;
  return prisma.user.create({
    data: {
      firstName: 'Sock',
      lastName: 'Notif',
      email: `notif-sock-${seq}@example.com`,
      passwordHash: 'x',
      isVerified: true,
      role,
      isBlocked,
    },
  });
};

async function mkProduct() {
  seq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Sofa ${seq}`, ar: `كنبة ${seq}` },
      description: { en: 'd', ar: 'د' },
      slug: `sofa-${seq}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10_000,
      stock: 10,
      categoryId,
      status: 'PUBLISHED',
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
    },
  });
}

const mkAddress = (uid: string) =>
  prisma.address.create({
    data: {
      userId: uid,
      label: 'Home',
      fullName: 'Sock Notif',
      phone: '+966551234567',
      cityCode: 'riyadh',
      area: 'Olaya',
      street: 'King Fahd Rd 12',
      notes: null,
      isDefault: true,
    },
  });

async function seedSettings() {
  await prisma.siteSetting.deleteMany();
  await prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'a@example.com',
      contactPhone: '+966551234567',
      deliveryFee: 0,
      freeDeliveryThreshold: null,
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
      deliveryCities: [
        {
          code: 'riyadh',
          name: { en: 'Riyadh', ar: 'الرياض' },
          isActive: true,
          sortOrder: 1,
          deliveryFee: null,
        },
      ],
    },
  });
}

/** Places a real order through the API for `user` (ORD-01 flow) and returns the order id. */
async function placeFor(user: { id: string }, appUnderTest = app): Promise<string> {
  const token = signAccessToken(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }));
  const p = await mkProduct();
  const address = await mkAddress(user.id);
  await prisma.cart.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      items: [{ productId: p.id, qty: 1, priceSeen: p.price }],
      version: 0,
    },
    update: { items: [{ productId: p.id, qty: 1, priceSeen: p.price }], version: { increment: 1 } },
  });
  const res = await request(appUnderTest)
    .post('/api/v1/orders')
    .set(auth(token))
    .set('Idempotency-Key', crypto.randomUUID())
    .send({ addressId: address.id, expectedTotal: 10_000 })
    .expect(201);
  return (res.body as { id: string }).id;
}

const patchStatus = (id: string, status: string, appUnderTest = app) =>
  request(appUnderTest)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth(adminToken))
    .send(status === 'CANCELLED' ? { status, note: 'admin cancel' } : { status });

const waitForRows = (where: Prisma.NotificationWhereInput, n: number) =>
  vi.waitFor(async () => {
    expect(await prisma.notification.count({ where })).toBe(n);
  });

/** A REAL pino logger (the test environment's own logger is silent) writing into memory. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, stream);
  return { logger, text: () => lines.join('') };
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await ensureSocketIndexes();
  server = await startSocketServer(env);
});

beforeEach(async () => {
  setTransport(nodemailer.createTransport({ jsonTransport: true })); // keep order emails off SMTP
  await Promise.all([
    prisma.notification.deleteMany(),
    prisma.order.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.address.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.counter.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await seedSettings();
  admin = await mkUser('ADMIN');
  adminToken = signAccessToken(admin);
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Sofas', ar: 'كنب' }, slug: 'sofas', image: null, parentId: null },
    })
  ).id;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const socket of clients.splice(0)) socket.disconnect();
});

afterAll(async () => {
  await server?.close();
  setTransport(undefined);
  await prisma.notification.deleteMany();
  await prisma.order.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.address.deleteMany();
  await prisma.product.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSetting.deleteMany();
  await closeMongoClient();
  await prisma.$disconnect();
});

describe('T-016 · notification consumers + socket delivery', () => {
  it('NOTIF-02 · a new order writes one row per non-blocked admin and each admin receives their OWN row via notification:new', async () => {
    const admin2 = await mkUser('ADMIN');
    await mkUser('ADMIN', true); // blocked: no row, no emit
    const customer = await mkUser();

    const socket1 = await join(adminToken);
    const socket2 = await join(signAccessToken(admin2));
    const customerSocket = await join(signAccessToken(customer));
    const customerReceived: unknown[] = [];
    customerSocket.on('notification:new', (p: unknown) => customerReceived.push(p));

    const p1 = waitForEvent<NotificationResponse>(socket1, 'notification:new');
    const p2 = waitForEvent<NotificationResponse>(socket2, 'notification:new');
    await placeFor(customer);

    await waitForRows({ type: 'NEW_ORDER' }, 2); // one per non-blocked admin, none for the blocked one
    const rows = await prisma.notification.findMany({ where: { type: 'NEW_ORDER' } });
    const byUser = new Map(rows.map((r) => [r.userId, r]));
    const [got1, got2] = await Promise.all([p1, p2]);

    // Each admin got THEIR row, id included (owner 2026-11-22: no shared admins-room payload).
    expect(got1.id).toBe(byUser.get(admin.id)!.id);
    expect(got2.id).toBe(byUser.get(admin2.id)!.id);
    expect(got1.type).toBe('NEW_ORDER');
    expect(got1.title.ar).toBe('طلب جديد');
    expect(got1.body.en).toContain('FX-');
    expect(got1.body.ar).toMatch(/[؀-ۿ]/); // rule 7: both locales present
    const order = await prisma.order.findFirstOrThrow({ where: { userId: customer.id } });
    expect(got1.data).toMatchObject({ orderId: order.id, orderNo: order.orderNo });
    expect(got1.link).toBe(`/orders/${order.id}`);
    expect(got1.readAt).toBeNull();

    await sleep(300); // a wrong delivery would need time to show up
    expect(customerReceived).toEqual([]); // the customer gets no NEW_ORDER notification
  });

  it('NOTIF-01 · an admin status change writes the customer row and emits notification:new + order:updated to user:{id}', async () => {
    const customer = await mkUser();
    const orderId = await placeFor(customer);
    const socket = await join(signAccessToken(customer));

    const notifP = waitForEvent<NotificationResponse>(socket, 'notification:new');
    const updatedP = waitForEvent<{ id: string; status: string }>(socket, 'order:updated');
    await patchStatus(orderId, 'CONFIRMED').expect(200);

    const [notif, updated] = await Promise.all([notifP, updatedP]);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: customer.id } });
    expect(notif.id).toBe(row.id); // the customer's own row, id included
    expect(notif.type).toBe('ORDER_STATUS');
    expect(notif.body.en).toContain('Confirmed');
    expect(notif.body.ar).toContain('تم التأكيد'); // rule 7: localized status name
    expect(updated).toEqual({ id: orderId, status: 'CONFIRMED' });
    // Exactly one ORDER_STATUS row, and it is the customer's (admins get nothing on an admin status
    // change; the placement's NEW_ORDER row for the admin is a separate, earlier event).
    const statusRows = await prisma.notification.findMany({ where: { type: 'ORDER_STATUS' } });
    expect(statusRows.map((r) => r.userId)).toEqual([customer.id]);
  });

  it('NOTIF-01 · notification created while the socket was disconnected is shown after reconnect with unread incremented', async () => {
    const customer = await mkUser();
    const token = signAccessToken(customer);
    const orderId = await placeFor(customer);

    const socket = await join(token);
    const before = await request(app).get('/api/v1/notifications').set(auth(token)).expect(200);
    expect(before.body.unread).toBe(0);

    socket.disconnect(); // offline while the admin changes the status
    await patchStatus(orderId, 'CONFIRMED').expect(200);
    await waitForRows({ userId: customer.id }, 1);

    await join(token); // reconnect; the client contract then re-fetches GET /notifications
    const after = await request(app).get('/api/v1/notifications').set(auth(token)).expect(200);
    expect(after.body.unread).toBe(1);
    expect(after.body.items).toHaveLength(1);
    expect(after.body.items[0].type).toBe('ORDER_STATUS');
    expect(after.body.items[0].data.orderId).toBe(orderId);
  });

  it('NOTIF-02 · a new order while the admin was disconnected is shown after reconnect with unread incremented', async () => {
    const customer = await mkUser();
    const socket = await join(adminToken);
    socket.disconnect(); // offline while the order comes in

    await placeFor(customer);
    await waitForRows({ userId: admin.id, type: 'NEW_ORDER' }, 1);

    await join(adminToken);
    const res = await request(app).get('/api/v1/notifications').set(auth(adminToken)).expect(200);
    expect(res.body.unread).toBe(1);
    expect(res.body.items[0].type).toBe('NEW_ORDER');
  });

  it('NOTIF-01 · the row is written before the emit; a failing emit is logged and the request still succeeds', async () => {
    const customer = await mkUser();
    const orderId = await placeFor(customer);

    // Emits fail hard; at emit time the handler must already have committed the row.
    const rowsAtEmit: Promise<number>[] = [];
    vi.spyOn(socketEmitter, 'toUser').mockImplementation(
      () =>
        ({
          emit: () => {
            rowsAtEmit.push(prisma.notification.count({ where: { userId: customer.id } }));
            throw new Error('emit down (test)');
          },
        }) as unknown as ReturnType<typeof socketEmitter.toUser>,
    );

    const cap = capture();
    const capApp = createApp({ logger: cap.logger });
    const res = await patchStatus(orderId, 'CONFIRMED', capApp);
    expect(res.status).toBe(200); // the transition commits regardless of the emit

    await waitForRows({ userId: customer.id }, 1); // the row is there although every emit failed
    expect(rowsAtEmit.length).toBeGreaterThan(0);
    expect(await rowsAtEmit[0]!).toBe(1); // row first, emit second
    await vi.waitFor(() => {
      expect(cap.text()).toContain('order event handler failed'); // logged, never thrown at the request
    });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'CONFIRMED',
    );
  });

  it('NOTIF-01 · an admin cancel never leaks the internal status note into the customer notification', async () => {
    const customer = await mkUser();
    const orderId = await placeFor(customer);
    await patchStatus(orderId, 'CANCELLED').expect(200); // carries the required internal note 'admin cancel'
    await waitForRows({ userId: customer.id }, 1);
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: customer.id } });
    expect(row.type).toBe('ORDER_STATUS');
    expect(row.body.en).toContain('Cancelled');
    for (const text of [row.title.en, row.title.ar, row.body.en, row.body.ar]) {
      expect(text).not.toContain('admin cancel'); // StatusEvent notes are admin-only (T-014/T-015)
    }
  });

  it('NOTIF-02 · a customer cancel notifies every admin, not the customer', async () => {
    const admin2 = await mkUser('ADMIN');
    const customer = await mkUser();
    const token = signAccessToken(customer);
    const orderId = await placeFor(customer);

    const adminSocket = await join(signAccessToken(admin2));
    const customerSocket = await join(token);
    const customerNotifs: unknown[] = [];
    customerSocket.on('notification:new', (p: unknown) => customerNotifs.push(p));

    // The placement's NEW_ORDER emit may still arrive on the freshly joined admin socket (adapter
    // latency), so wait specifically for the cancel's ORDER_STATUS notification.
    const adminP = new Promise<NotificationResponse>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout waiting for ORDER_STATUS')), 5000);
      adminSocket.on('notification:new', (p: NotificationResponse) => {
        if (p.type !== 'ORDER_STATUS') return;
        clearTimeout(t);
        resolve(p);
      });
    });
    const updatedP = waitForEvent<{ id: string; status: string }>(customerSocket, 'order:updated');
    await request(app)
      .post(`/api/v1/orders/${orderId}/cancel`)
      .set(auth(token))
      .send({ reason: 'changed my mind' })
      .expect(200);

    await waitForRows({ type: 'ORDER_STATUS' }, 2); // one per admin (admin + admin2)
    expect(await prisma.notification.count({ where: { userId: customer.id } })).toBe(0);

    const adminNotif = await adminP;
    expect(adminNotif.type).toBe('ORDER_STATUS');
    expect(adminNotif.body.en).toContain('Customer cancelled order');
    expect(adminNotif.body.en).toContain('changed my mind'); // the reason is admin-visible (T-015)
    expect(adminNotif.body.ar).toContain('changed my mind');
    expect(adminNotif.body.ar).toMatch(/[؀-ۿ]/);

    // order:updated is state sync and still reaches the customer; notification:new never does.
    expect(await updatedP).toEqual({ id: orderId, status: 'CANCELLED' });
    await sleep(300);
    expect(customerNotifs).toEqual([]);
  });
});
