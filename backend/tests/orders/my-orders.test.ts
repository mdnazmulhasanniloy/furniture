import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_myorders_t013',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const BASE = '/api/v1/orders';

let token = '';
let userId = '';
let otherId = '';
let adminToken = '';
let seq = 0;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

const mkOrder = (uid: string, over: Record<string, unknown> = {}) =>
  prisma.order.create({
    data: {
      orderNo: `FX-20261122-${String(++seq).padStart(4, '0')}`,
      userId: uid,
      idempotencyKey: crypto.randomUUID(),
      addressId: '0'.repeat(24),
      items: [
        {
          productId: '1'.repeat(24),
          titleSnapshot: { en: 'Sofa', ar: 'كنبة' },
          sku: 'SKU-1',
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
      deliveryFee: 1_000,
      vat: {
        vatRate: 15,
        vatAmount: 2_739,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
      total: 21_000,
      statusHistory: [
        { status: 'PENDING', at: new Date('2026-11-22T08:00:00Z'), byUserId: uid, note: null },
        { status: 'CONFIRMED', at: new Date('2026-11-22T09:00:00Z'), byUserId: null, note: null },
      ],
      status: 'CONFIRMED',
      customerNote: 'ring the bell',
      adminNote: null,
      ...over,
    },
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne');
  const mk = (email: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') =>
    prisma.user.create({
      data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true, role },
    });
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  const [u, o, a] = await Promise.all([
    mk('me@example.com'),
    mk('other@example.com'),
    mk('admin@example.com', 'ADMIN'),
  ]);
  [userId, otherId] = [u.id, o.id];
  [token, adminToken] = [signAccessToken(u), signAccessToken(a)];
});

beforeEach(async () => {
  await prisma.order.deleteMany();
});

afterAll(async () => {
  await prisma.order.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ORD-02 · my orders', () => {
  it('ORD-02 · lists only my orders, newest first, paginated', async () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 22, h));
    const [, mid, newest] = await Promise.all([
      mkOrder(userId, { createdAt: at(1) }),
      mkOrder(userId, { createdAt: at(2) }),
      mkOrder(userId, { createdAt: at(3) }),
    ]);
    await mkOrder(otherId, { createdAt: at(4) });

    const res = await request(app).get(BASE).set(auth(token)).expect(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 20, total: 3, totalPages: 1 });
    expect(res.body.items.map((o: { id: string }) => o.id)).toEqual([
      newest!.id,
      mid!.id,
      res.body.items[2].id,
    ]);
    expect(res.body.items.map((o: { user: { id: string } }) => o.user.id)).toEqual(
      Array(3).fill(userId) as string[],
    );

    const page2 = await request(app).get(`${BASE}?page=2&limit=2`).set(auth(token)).expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.meta).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('ORD-02 · detail shows items, address snapshot, totals and the status timeline', async () => {
    const order = await mkOrder(userId);
    const res = await request(app).get(`${BASE}/${order.id}`).set(auth(token)).expect(200);
    expect(res.body).toMatchObject({
      id: order.id,
      orderNo: order.orderNo,
      subtotal: 20_000,
      deliveryFee: 1_000,
      total: 21_000,
      currency: 'SAR',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      status: 'CONFIRMED',
      customerNote: 'ring the bell',
      adminNote: null,
    });
    expect(res.body.user).toEqual({
      id: userId,
      firstName: 'T',
      lastName: 'U',
      email: 'me@example.com',
    });
    expect(res.body.items).toEqual([
      {
        productId: '1'.repeat(24),
        titleSnapshot: { en: 'Sofa', ar: 'كنبة' },
        sku: 'SKU-1',
        imageSnapshot: null,
        unitPrice: 10_000,
        qty: 2,
        lineTotal: 20_000,
        type: 'NEW',
        condition: 'NEW',
      },
    ]);
    expect(res.body.address).toEqual({
      fullName: 'Sara Ali',
      phone: '+966551234567',
      cityCode: 'riyadh',
      city: { en: 'Riyadh', ar: 'الرياض' },
      area: 'Olaya',
      street: 'King Fahd Rd 12',
      notes: null,
    });
    expect(res.body.vat).toEqual({
      vatRate: 15,
      vatAmount: 2_739,
      applyToDelivery: true,
      pricesIncludeVat: true,
      registrationNumber: null,
    });
    expect(res.body.statusHistory).toEqual([
      { status: 'PENDING', at: '2026-11-22T08:00:00.000Z', byUserId: userId, note: null },
      { status: 'CONFIRMED', at: '2026-11-22T09:00:00.000Z', byUserId: null, note: null },
    ]);
  });

  it("ORD-02 · another user's order, an unknown or a malformed id → 404", async () => {
    const foreign = await mkOrder(otherId);
    for (const id of [foreign.id, '0'.repeat(24), 'not-an-id']) {
      expect((await request(app).get(`${BASE}/${id}`).set(auth(token))).status).toBe(404);
    }
  });

  it('ORD-02 · requires a customer: no token → 401, admin → 403', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(BASE).set(auth(adminToken))).status).toBe(403);
  });
});
