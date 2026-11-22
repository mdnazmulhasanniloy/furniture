import { execSync } from 'node:child_process';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_customercancel_t015',
  );
});

import type { OrderStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { setTransport } from '../../src/emails/mailer.js';
import { onOrderEvent, type OrderEvent } from '../../src/lib/orderEvents.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { testHooks } from '../../src/modules/orders/service.js';

const app = createApp();
const BASE = '/api/v1/orders';

let hash = '';
let token = ''; // customer (order owner)
let userId = '';
let otherToken = ''; // another customer
let adminToken = '';
let categoryId = '';
let seq = 0;

interface SentMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}
let sent: SentMail[] = [];

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Capturing transport (T-014 pattern): records every mail. */
function captureTransport() {
  const t = nodemailer.createTransport({ jsonTransport: true });
  vi.spyOn(t, 'sendMail').mockImplementation((opts) => {
    sent.push(opts as unknown as SentMail);
    return Promise.resolve({} as never);
  });
  return t;
}

async function mkProduct(over: Record<string, unknown> = {}) {
  seq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Sofa ${seq}`, ar: `كنبة ${seq}` },
      description: { en: 'd', ar: 'د' },
      slug: `sofa-${seq}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10_000,
      stock: 5,
      categoryId,
      status: 'PUBLISHED',
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
      ...over,
    },
  });
}

/** Direct order fixture (T-014 pattern); one line of qty 2 for `productId`. */
const mkOrder = (
  uid: string,
  status: OrderStatus,
  productId: string,
  over: Record<string, unknown> = {},
) =>
  prisma.order.create({
    data: {
      orderNo: `FX-20260101-${String(++seq).padStart(4, '0')}`,
      userId: uid,
      idempotencyKey: crypto.randomUUID(),
      addressId: '0'.repeat(24),
      items: [
        {
          productId,
          titleSnapshot: { en: 'Sofa', ar: 'كنبة' },
          sku: null,
          imageSnapshot: null,
          imageKey: null,
          unitPrice: 10_000,
          qty: 2,
          lineTotal: 20_000,
          type: 'NEW',
          condition: 'NEW',
        },
      ],
      address: {
        fullName: 'Sara Ali',
        phone: '+966551234567',
        cityCode: 'riyadh',
        city: { en: 'Riyadh', ar: 'الرياض' },
        area: 'Olaya',
        street: 'King Fahd Rd 12',
        notes: null,
      },
      subtotal: 20_000,
      deliveryFee: 0,
      vat: {
        vatRate: 0,
        vatAmount: 0,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
      total: 20_000,
      status,
      statusHistory: [
        { status: 'PENDING', at: new Date('2026-11-20T08:00:00Z'), byUserId: uid, note: null },
      ],
      customerNote: null,
      adminNote: null,
      ...over,
    },
  });

const cancel = (id: string, t = token) => request(app).post(`${BASE}/${id}/cancel`).set(auth(t));

const adminPatchStatus = (id: string, status: string, note?: string) =>
  request(app)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth(adminToken))
    .send(note === undefined ? { status } : { status, note });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});

beforeEach(async () => {
  sent = [];
  setTransport(captureTransport());
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  const mk = (email: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
    prisma.user.create({
      data: {
        firstName: 'Sara',
        lastName: 'Ali',
        email,
        passwordHash: hash,
        isVerified: true,
        role,
        preferredLocale: 'ar',
      },
    });
  const [u, o, a] = await Promise.all([
    mk('me@example.com'),
    mk('other@example.com'),
    mk('admin@example.com', 'ADMIN'),
  ]);
  userId = u.id;
  [token, otherToken, adminToken] = [signAccessToken(u), signAccessToken(o), signAccessToken(a)];
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Sofas', ar: 'كنب' }, slug: 'sofas', image: null, parentId: null },
    })
  ).id;
});

afterEach(() => {
  delete testHooks.beforeTransition;
});

afterAll(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.product.deleteMany()]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  setTransport(undefined);
  await prisma.$disconnect();
});

describe('ORD-03 · customer cancel', () => {
  it('ORD-03 · cancelling an own PENDING order → 200 CANCELLED, stock restored, UNPAID, customer-shaped body', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    const res = await cancel(order.id).expect(200);
    expect(res.body).toMatchObject({
      id: order.id,
      status: 'CANCELLED',
      paymentStatus: 'UNPAID',
    });
    // Customer shape: no adminNote, history events reduced to {status, at}.
    expect(res.body).not.toHaveProperty('adminNote');
    expect(res.body.statusHistory).toEqual([
      { status: 'PENDING', at: expect.any(String) },
      { status: 'CANCELLED', at: expect.any(String) },
    ]);

    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.statusHistory.at(-1)).toMatchObject({
      status: 'CANCELLED',
      byUserId: userId,
      note: null,
    });
  });

  it('ORD-03 · cancel reason is stored and visible to admin', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);

    await cancel(order.id).send({ reason: '  Found a cheaper sofa  ' }).expect(200);

    // Stored trimmed as the StatusEvent note.
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.statusHistory.at(-1)).toMatchObject({
      status: 'CANCELLED',
      byUserId: userId,
      note: 'Found a cheaper sofa',
    });

    // Admin order detail shows it.
    const adminRes = await request(app)
      .get(`/api/v1/admin/orders/${order.id}`)
      .set(auth(adminToken))
      .expect(200);
    expect(adminRes.body.statusHistory.at(-1)).toMatchObject({
      status: 'CANCELLED',
      byUserId: userId,
      note: 'Found a cheaper sofa',
    });
  });

  it('ORD-03 · cancel reason is hidden from the customer response and absent from the email', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    const reason = 'Found a cheaper sofa';

    const res = await cancel(order.id).send({ reason }).expect(200);
    // Customer shape: history events carry only {status, at}.
    for (const e of res.body.statusHistory as Record<string, unknown>[]) {
      expect(Object.keys(e).sort()).toEqual(['at', 'status']);
    }
    expect(JSON.stringify(res.body)).not.toContain(reason);

    const mine = await request(app).get(`${BASE}/${order.id}`).set(auth(token)).expect(200);
    expect(JSON.stringify(mine.body)).not.toContain(reason);

    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    const mail = sent[0]!;
    expect(`${mail.subject} ${mail.html} ${mail.text}`).not.toContain(reason);
  });

  it('ORD-03 · reason over 300 chars → 422', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    const res = await cancel(order.id).send({ reason: 'x'.repeat(301) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
    expect(after.statusHistory).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ORD-03 · cancel without a body still works', async () => {
    const p = await mkProduct({ stock: 5 });
    const a = await mkOrder(userId, 'PENDING', p.id);
    const b = await mkOrder(userId, 'PENDING', p.id);

    await cancel(a.id).expect(200); // no body at all
    await cancel(b.id).send({ reason: '   ' }).expect(200); // empty (trimmed) reason = no reason

    for (const id of [a.id, b.id]) {
      const stored = await prisma.order.findUniqueOrThrow({ where: { id } });
      expect(stored.status).toBe('CANCELLED');
      expect(stored.statusHistory.at(-1)).toMatchObject({ status: 'CANCELLED', note: null });
    }
  });

  it('ORD-03 · CONFIRMED or later → 409 INVALID_TRANSITION with empty allowed, nothing changes', async () => {
    for (const from of [
      'CONFIRMED',
      'PROCESSING',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
      'CANCELLED',
    ] as const) {
      const p = await mkProduct({ stock: 5 });
      const order = await mkOrder(userId, from, p.id);
      const res = await cancel(order.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      // The customer matrix allows nothing from a non-PENDING status — even though the admin
      // matrix would allow CONFIRMED → CANCELLED.
      expect(res.body.details).toEqual({ from, to: 'CANCELLED', allowed: [] });
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe(from);
      expect(after.statusHistory).toHaveLength(1);
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
    }
  });

  it("ORD-03 · another user's order, an unknown id and a malformed id → 404; ownership is not revealed", async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    const res = await cancel(order.id, otherToken);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await cancel('0'.repeat(24))).status).toBe(404);
    expect((await cancel('not-an-id')).status).toBe(404);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ORD-03 · anonymous → 401; an admin on the customer route → 403', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    expect((await request(app).post(`${BASE}/${order.id}/cancel`)).status).toBe(401);
    expect((await cancel(order.id, adminToken)).status).toBe(403);
  });

  it('ORD-03 · an admin CONFIRM racing the cancel wins: the retry re-checks the fresh status → 409', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    // Hold the FIRST arriver (the customer cancel) after its PENDING read; the admin CONFIRM
    // arrives second, proceeds and commits. The released cancel's conditional write then misses,
    // and the retry must re-check the CUSTOMER matrix against the fresh CONFIRMED status —
    // without that re-check the general matrix would let the customer cancel a CONFIRMED order.
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    testHooks.beforeTransition = async (attempt) => {
      if (attempt > 0) return;
      arrivals += 1;
      if (arrivals === 1) await gate;
    };

    const cancelReq = cancel(order.id).then((r) => r);
    await vi.waitFor(() => {
      expect(arrivals).toBe(1);
    });
    await adminPatchStatus(order.id, 'CONFIRMED').expect(200);
    release();
    const res = await cancelReq;

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect(res.body.details).toEqual({ from: 'CONFIRMED', to: 'CANCELLED', allowed: [] });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ORD-03 · a concurrent customer + admin cancel restore stock exactly once (stale-read interleaving)', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    // Both requests READ the PENDING order; the second arriver is held until the first one's
    // response, so its conditional write runs against a stale read (T-014 barrier pattern).
    let arrivals = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    testHooks.beforeTransition = async (attempt) => {
      if (attempt > 0) return; // the loser's retry proceeds freely
      arrivals += 1;
      if (arrivals === 2) await gate;
    };

    const customerReq = cancel(order.id).then((r) => r);
    const adminReq = adminPatchStatus(order.id, 'CANCELLED', 'customer asked by phone').then(
      (r) => r,
    );
    await vi.waitFor(() => {
      expect(arrivals).toBe(2);
    });
    const winner = await Promise.race([customerReq, adminReq]);
    expect(winner.status).toBe(200);
    release();
    const [customerRes, adminRes] = await Promise.all([customerReq, adminReq]);

    expect([customerRes.status, adminRes.status].sort()).toEqual([200, 409]);
    const loser = customerRes.status === 409 ? customerRes : adminRes;
    expect(loser.body.code).toBe('INVALID_TRANSITION');

    // Stock restored exactly once, one CANCELLED history event.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe('CANCELLED');
    expect(stored.statusHistory.filter((e) => e.status === 'CANCELLED')).toHaveLength(1);
  });

  it('ORD-03 · cancel emits order.statusChanged with the customer id and sends the cancellation email in the customer locale', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    const events: OrderEvent[] = [];
    const off = onOrderEvent('order.statusChanged', (e) => {
      events.push(e);
    });
    try {
      await cancel(order.id).expect(200);
      expect(events).toHaveLength(1);
      expect(events[0]!.change).toEqual({
        orderId: order.id,
        from: 'PENDING',
        to: 'CANCELLED',
        byUserId: userId,
      });
    } finally {
      off();
    }
    await vi.waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    const mail = sent[0]!;
    expect(mail.to).toBe('me@example.com');
    expect(mail.subject).toMatch(/[؀-ۿ]/); // preferredLocale ar → Arabic template
    expect(mail.subject).toContain(order.orderNo);
  });
});
