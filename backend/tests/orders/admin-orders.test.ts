import { execSync } from 'node:child_process';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_adminorders_t014',
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
const BASE = '/api/v1/admin/orders';

let hash = '';
let token = ''; // customer
let userId = '';
let adminToken = '';
let adminId = '';
let categoryId = '';
let seq = 0;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

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

/** Direct order fixture; `items` default to one line of qty 2 for `productId`. */
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

const patchStatus = (id: string, status: string, note?: string, t = adminToken) =>
  request(app)
    .patch(`${BASE}/${id}/status`)
    .set(auth(t))
    .send(note === undefined ? { status } : { status, note });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne!');
  // Silence the ORD-04 consumers: a real transport is never configured in tests.
  setTransport(nodemailer.createTransport({ jsonTransport: true }));
});

beforeEach(async () => {
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  const mk = (email: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
    prisma.user.create({
      data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true, role },
    });
  const [u, a] = await Promise.all([mk('me@example.com'), mk('admin@example.com', 'ADMIN')]);
  [userId, adminId] = [u.id, a.id];
  [token, adminToken] = [signAccessToken(u), signAccessToken(a)];
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

// ---------------------------------------------------------------- transition matrix

describe('ADM-04 · status transitions', () => {
  it('ADM-04 · the happy path PENDING→CONFIRMED→PROCESSING→OUT_FOR_DELIVERY→DELIVERED appends one event per step with the admin id', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    for (const [status, note] of [
      ['CONFIRMED', 'called the customer'],
      ['PROCESSING', undefined],
      ['OUT_FOR_DELIVERY', undefined],
      ['DELIVERED', undefined],
    ] as const) {
      const res = await patchStatus(order.id, status, note);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe(status);
    }
    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(final.statusHistory.map((e) => e.status)).toEqual([
      'PENDING',
      'CONFIRMED',
      'PROCESSING',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
    expect(final.statusHistory.slice(1).every((e) => e.byUserId === adminId)).toBe(true);
    expect(final.statusHistory[1]!.note).toBe('called the customer');
    // Stock is only restored on cancel — a delivery changes nothing.
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ADM-04 · every invalid transition → 409 INVALID_TRANSITION with {from, to, allowed} and no change', async () => {
    const p = await mkProduct();
    const cases: [OrderStatus, string][] = [
      ['PENDING', 'PROCESSING'],
      ['PENDING', 'OUT_FOR_DELIVERY'],
      ['PENDING', 'DELIVERED'],
      ['PENDING', 'PENDING'],
      ['CONFIRMED', 'DELIVERED'],
      ['CONFIRMED', 'PENDING'],
      ['PROCESSING', 'CONFIRMED'],
      ['OUT_FOR_DELIVERY', 'PROCESSING'],
      ['DELIVERED', 'PENDING'],
      ['CANCELLED', 'CONFIRMED'],
    ];
    for (const [from, to] of cases) {
      const order = await mkOrder(userId, from, p.id);
      const res = await patchStatus(order.id, to, 'a valid-length note');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(res.body.details).toMatchObject({ from, to });
      expect(Array.isArray(res.body.details.allowed)).toBe(true);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe(from);
      expect(after.statusHistory).toHaveLength(1);
    }
  });

  it('ADM-04 · cancelling after DELIVERED is 409 and does not restore stock', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'DELIVERED', p.id, { paymentStatus: 'PAID' });
    const res = await patchStatus(order.id, 'CANCELLED', 'customer changed their mind');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ADM-04 · DELIVERED sets paymentStatus PAID in the same write', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'OUT_FOR_DELIVERY', p.id);
    const res = await patchStatus(order.id, 'DELIVERED');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
  });

  it('ADM-04 · cancelling from each non-terminal state restores stock and leaves paymentStatus UNPAID', async () => {
    for (const from of ['PENDING', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY'] as const) {
      const p = await mkProduct({ stock: 5 });
      const order = await mkOrder(userId, from, p.id);
      const res = await patchStatus(order.id, 'CANCELLED', `refused at delivery (${from})`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
      expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
      const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(stored.statusHistory.at(-1)).toMatchObject({
        status: 'CANCELLED',
        byUserId: adminId,
        note: `refused at delivery (${from})`,
      });
    }
  });

  it('ADM-04 · a cancel without a note, or with one shorter than 3 chars, → 422 and nothing changes', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);
    for (const body of [{ status: 'CANCELLED' }, { status: 'CANCELLED', note: 'ab' }]) {
      const res = await request(app)
        .patch(`${BASE}/${order.id}/status`)
        .set(auth(adminToken))
        .send(body);
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    // The note bound also applies to other transitions when a note is sent.
    expect((await patchStatus(order.id, 'CONFIRMED', 'ab')).status).toBe(422);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PENDING');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it('ADM-04 · cancel restores stock of an ARCHIVED product', async () => {
    const p = await mkProduct({ status: 'ARCHIVED', stock: 1 });
    const order = await mkOrder(userId, 'CONFIRMED', p.id);
    expect((await patchStatus(order.id, 'CANCELLED', 'supplier issue')).status).toBe(200);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(3);
  });

  it('ADM-04 · order.statusChanged is emitted after commit with {orderId, from, to, byUserId}', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    const events: OrderEvent[] = [];
    const off = onOrderEvent('order.statusChanged', (e) => {
      events.push(e);
    });
    try {
      await patchStatus(order.id, 'CONFIRMED').expect(200);
      // An invalid transition must emit nothing.
      await patchStatus(order.id, 'DELIVERED').expect(409);
      expect(events).toHaveLength(1);
      expect(events[0]!.change).toEqual({
        orderId: order.id,
        from: 'PENDING',
        to: 'CONFIRMED',
        byUserId: adminId,
      });
      expect(events[0]!.order.status).toBe('CONFIRMED');
    } finally {
      off();
    }
  });

  it('ADM-04 · two concurrent cancels restore stock exactly once (stale-read interleaving)', async () => {
    const p = await mkProduct({ stock: 5 });
    const order = await mkOrder(userId, 'PENDING', p.id);

    // Both requests READ the PENDING order; the second arriver is held until the first one's
    // response, so its conditional write runs against a stale read (the race Mongo's own
    // write-conflict detection would otherwise mask).
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

    // .then() dispatches the lazy supertest request immediately.
    const reqA = patchStatus(order.id, 'CANCELLED', 'first cancel').then((r) => r);
    const reqB = patchStatus(order.id, 'CANCELLED', 'second cancel').then((r) => r);
    await vi.waitFor(() => {
      expect(arrivals).toBe(2);
    });
    const winner = await Promise.race([reqA, reqB]);
    expect(winner.status).toBe(200);
    release();
    const [resA, resB] = await Promise.all([reqA, reqB]);

    expect([resA.status, resB.status].sort()).toEqual([200, 409]);
    const loser = resA.status === 409 ? resA : resB;
    expect(loser.body.code).toBe('INVALID_TRANSITION');
    expect(loser.body.details).toMatchObject({ from: 'CANCELLED', to: 'CANCELLED' });

    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.statusHistory.filter((e) => e.status === 'CANCELLED')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- list + search + detail

describe('ADM-04 · list, filters and search', () => {
  it('ADM-04 · lists newest first with pagination and a status filter', async () => {
    const p = await mkProduct();
    const at = (h: number) => new Date(Date.UTC(2026, 10, 22, h));
    await mkOrder(userId, 'PENDING', p.id, { createdAt: at(1) });
    const confirmed = await mkOrder(userId, 'CONFIRMED', p.id, { createdAt: at(2) });
    const newest = await mkOrder(userId, 'PENDING', p.id, { createdAt: at(3) });

    const res = await request(app).get(BASE).set(auth(adminToken)).expect(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(res.body.items[0].id).toBe(newest.id);
    // Admin rows carry the buyer and the full admin shape.
    expect(res.body.items[0].user).toMatchObject({ id: userId, email: 'me@example.com' });
    expect(res.body.items[0]).toHaveProperty('adminNote');

    const filtered = await request(app)
      .get(`${BASE}?status=CONFIRMED`)
      .set(auth(adminToken))
      .expect(200);
    expect(filtered.body.items.map((o: { id: string }) => o.id)).toEqual([confirmed.id]);

    const page2 = await request(app)
      .get(`${BASE}?page=2&limit=2`)
      .set(auth(adminToken))
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
  });

  it('ADM-04 · from/to are inclusive Asia/Riyadh calendar days', async () => {
    const p = await mkProduct();
    // 2026-11-21T20:59Z = Nov 21 23:59 Riyadh; 21:00Z = Nov 22 00:00 Riyadh.
    const before = await mkOrder(userId, 'PENDING', p.id, {
      createdAt: new Date('2026-11-21T20:59:00Z'),
    });
    const startOfDay = await mkOrder(userId, 'PENDING', p.id, {
      createdAt: new Date('2026-11-21T21:00:00Z'),
    });
    const endOfDay = await mkOrder(userId, 'PENDING', p.id, {
      createdAt: new Date('2026-11-22T20:59:00Z'),
    });
    const after = await mkOrder(userId, 'PENDING', p.id, {
      createdAt: new Date('2026-11-22T21:00:00Z'),
    });

    const res = await request(app)
      .get(`${BASE}?from=2026-11-22&to=2026-11-22`)
      .set(auth(adminToken))
      .expect(200);
    const ids = res.body.items.map((o: { id: string }) => o.id);
    expect(ids).toContain(startOfDay.id);
    expect(ids).toContain(endOfDay.id);
    expect(ids).not.toContain(before.id);
    expect(ids).not.toContain(after.id);

    // from > to yields an empty page, not an error.
    const empty = await request(app)
      .get(`${BASE}?from=2026-11-23&to=2026-11-22`)
      .set(auth(adminToken))
      .expect(200);
    expect(empty.body.items).toEqual([]);
  });

  it('ADM-04 · q matches the orderNo and the customer email, case-insensitively', async () => {
    const p = await mkProduct();
    const mine = await mkOrder(userId, 'PENDING', p.id, { orderNo: 'FX-20260101-9001' });
    const other = await prisma.user.create({
      data: {
        firstName: 'O',
        lastName: 'U',
        email: 'someone.else@example.com',
        passwordHash: hash,
        isVerified: true,
      },
    });
    const theirs = await mkOrder(other.id, 'PENDING', p.id, { orderNo: 'FX-20260101-9002' });

    const byNo = await request(app).get(`${BASE}?q=9001`).set(auth(adminToken)).expect(200);
    expect(byNo.body.items.map((o: { id: string }) => o.id)).toEqual([mine.id]);

    const byEmail = await request(app)
      .get(`${BASE}?q=SOMEONE.ELSE%40example`)
      .set(auth(adminToken))
      .expect(200);
    expect(byEmail.body.items.map((o: { id: string }) => o.id)).toEqual([theirs.id]);
  });

  it('ADM-04 · regex metacharacters in q are literal ("." and "(") — rule 9', async () => {
    const p = await mkProduct();
    const dotUser = await prisma.user.create({
      data: {
        firstName: 'D',
        lastName: 'U',
        email: 'a.b@example.com',
        passwordHash: hash,
        isVerified: true,
      },
    });
    const xUser = await prisma.user.create({
      data: {
        firstName: 'X',
        lastName: 'U',
        email: 'axb@example.com',
        passwordHash: hash,
        isVerified: true,
      },
    });
    const dotOrder = await mkOrder(dotUser.id, 'PENDING', p.id);
    await mkOrder(xUser.id, 'PENDING', p.id);

    // "." must not act as a wildcard: only the literal "a.b" email matches.
    const res = await request(app).get(`${BASE}?q=a.b%40`).set(auth(adminToken)).expect(200);
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([dotOrder.id]);

    // "(" must not break the query: 200 with no matches, not a 500.
    const paren = await request(app).get(`${BASE}?q=%28sofa`).set(auth(adminToken)).expect(200);
    expect(paren.body.items).toEqual([]);
  });

  it('ADM-04 · q matching a Saudi phone ("055 123 4567", Arabic-Indic digits) finds the snapshot phone', async () => {
    const p = await mkProduct();
    const hit = await mkOrder(userId, 'PENDING', p.id); // snapshot phone +966551234567
    await mkOrder(userId, 'PENDING', p.id, {
      address: {
        fullName: 'Sara Ali',
        phone: '+966559999999',
        cityCode: 'riyadh',
        city: { en: 'Riyadh', ar: 'الرياض' },
        area: 'Olaya',
        street: 'King Fahd Rd 12',
        notes: null,
      },
    });
    for (const q of ['055 123 4567', '٠٥٥١٢٣٤٥٦٧']) {
      const res = await request(app).get(BASE).query({ q }).set(auth(adminToken)).expect(200);
      expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([hit.id]);
    }
  });

  it('ADM-04 · q over 100 chars or an unknown status → 422', async () => {
    expect(
      (
        await request(app)
          .get(`${BASE}?q=${'a'.repeat(101)}`)
          .set(auth(adminToken))
      ).status,
    ).toBe(422);
    expect((await request(app).get(`${BASE}?status=SHIPPED`).set(auth(adminToken))).status).toBe(
      422,
    );
    expect((await request(app).get(`${BASE}?from=2026-13-01`).set(auth(adminToken))).status).toBe(
      422,
    );
  });

  it('ADM-04 · detail returns the full admin shape; unknown or malformed ids → 404', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id, { adminNote: 'VIP customer' });
    const res = await request(app).get(`${BASE}/${order.id}`).set(auth(adminToken)).expect(200);
    expect(res.body.adminNote).toBe('VIP customer');
    expect(res.body.statusHistory[0]).toMatchObject({
      status: 'PENDING',
      byUserId: userId,
      note: null,
    });

    for (const id of ['0'.repeat(24), 'not-an-id']) {
      expect((await request(app).get(`${BASE}/${id}`).set(auth(adminToken))).status).toBe(404);
      expect((await patchStatus(id, 'CONFIRMED')).status).toBe(404);
      expect(
        (
          await request(app)
            .patch(`${BASE}/${id}/note`)
            .set(auth(adminToken))
            .send({ adminNote: 'x' })
        ).status,
      ).toBe(404);
    }
  });

  it('ADM-04 · admin routes require an admin: anonymous → 401, customer → 403', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    const calls = [
      request(app).get(BASE),
      request(app).get(`${BASE}/${order.id}`),
      request(app).patch(`${BASE}/${order.id}/status`).send({ status: 'CONFIRMED' }),
      request(app).patch(`${BASE}/${order.id}/note`).send({ adminNote: 'x' }),
    ];
    for (const call of calls) expect((await call).status).toBe(401);
    const asCustomer = [
      request(app).get(BASE).set(auth(token)),
      request(app).get(`${BASE}/${order.id}`).set(auth(token)),
      request(app)
        .patch(`${BASE}/${order.id}/status`)
        .set(auth(token))
        .send({ status: 'CONFIRMED' }),
      request(app).patch(`${BASE}/${order.id}/note`).set(auth(token)).send({ adminNote: 'x' }),
    ];
    for (const call of asCustomer) expect((await call).status).toBe(403);
  });
});

// ---------------------------------------------------------------- admin note + visibility

describe('ADM-04 · internal note and customer visibility', () => {
  it('ADM-04 · sets, trims, bounds and clears the admin note', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    const note = (adminNote: unknown) =>
      request(app).patch(`${BASE}/${order.id}/note`).set(auth(adminToken)).send({ adminNote });

    expect((await note('  VIP customer  ')).body.adminNote).toBe('VIP customer');
    expect((await note('x'.repeat(2000))).status).toBe(200);
    expect((await note('x'.repeat(2001))).status).toBe(422);
    expect((await note(null)).body.adminNote).toBe(null);
    expect((await note('')).body.adminNote).toBe(null); // empty string clears too
    expect(
      (await request(app).patch(`${BASE}/${order.id}/note`).set(auth(adminToken)).send({})).status,
    ).toBe(422);
  });

  it('ADM-04 · adminNote, status notes and byUserId never appear in customer responses', async () => {
    const p = await mkProduct();
    const order = await mkOrder(userId, 'PENDING', p.id);
    await request(app)
      .patch(`${BASE}/${order.id}/note`)
      .set(auth(adminToken))
      .send({ adminNote: 'internal: flagged for review' })
      .expect(200);
    await patchStatus(order.id, 'CANCELLED', 'internal cancel reason').expect(200);

    const res = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(token)).expect(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.statusHistory).toEqual([
      { status: 'PENDING', at: expect.any(String) },
      { status: 'CANCELLED', at: expect.any(String) },
    ]);
    expect(JSON.stringify(res.body)).not.toContain('internal');
    expect(JSON.stringify(res.body)).not.toContain(adminId);
  });
});
