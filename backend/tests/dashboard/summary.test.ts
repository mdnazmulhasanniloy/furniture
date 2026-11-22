import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_dashboard_t018',
  );
});

import type { OrderStatus, ProductStatus, User } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const URL = '/api/v1/admin/dashboard/summary';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

// Pinned clock: 2026-11-23 10:00 Asia/Riyadh (07:00 UTC). Riyadh is fixed UTC+3.
const NOW = new Date('2026-11-23T07:00:00Z');
/** The UTC instant of `YYYY-MM-DDTHH:mm` on the Riyadh clock. */
const riyadh = (local: string) => new Date(`${local}:00+03:00`);

let admin: User;
let customer: User;
let adminToken = '';
let customerToken = '';
let userId = '';
let categoryId = '';
let seq = 0;

const mkOrder = (over: Record<string, unknown> = {}) => {
  const status = (over.status as OrderStatus | undefined) ?? 'PENDING';
  const createdAt = (over.createdAt as Date | undefined) ?? NOW;
  return prisma.order.create({
    data: {
      orderNo: `FX-20260101-${String(++seq).padStart(4, '0')}`,
      userId,
      idempotencyKey: randomUUID(),
      addressId: '0'.repeat(24),
      items: [],
      address: {
        fullName: 'Sara Ali',
        phone: '+966551234567',
        cityCode: 'riyadh',
        city: { en: 'Riyadh', ar: 'الرياض' },
        area: 'Olaya',
        street: 'King Fahd Rd 12',
        notes: null,
      },
      subtotal: 10_000,
      deliveryFee: 0,
      vat: {
        vatRate: 0,
        vatAmount: 0,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
      total: 10_000,
      status,
      statusHistory: [{ status: 'PENDING', at: createdAt, byUserId: userId, note: null }],
      customerNote: null,
      adminNote: null,
      createdAt,
      ...over,
    },
  });
};

/** A DELIVERED order whose DELIVERED status event is at `deliveredAt`. */
const mkDelivered = (deliveredAt: Date, total: number, createdAt = deliveredAt) =>
  mkOrder({
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    total,
    createdAt,
    statusHistory: [
      { status: 'PENDING', at: createdAt, byUserId: userId, note: null },
      { status: 'CONFIRMED', at: createdAt, byUserId: null, note: null },
      { status: 'DELIVERED', at: deliveredAt, byUserId: null, note: null },
    ],
  });

const mkProduct = (status: ProductStatus, stock: number) => {
  seq += 1;
  return prisma.product.create({
    data: {
      title: { en: `Sofa ${seq}`, ar: `كنبة ${seq}` },
      description: { en: 'd', ar: 'د' },
      slug: `sofa-${seq}`,
      type: 'NEW',
      condition: 'NEW',
      price: 10_000,
      stock,
      categoryId,
      status,
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: null,
      color: null,
    },
  });
};

const summary = (t = adminToken) => request(app).get(URL).set(auth(t));

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne');
  admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      role: 'ADMIN',
      isVerified: true,
      invitedById: null,
    },
  });
  customer = await prisma.user.create({
    data: {
      firstName: 'Cust',
      lastName: 'Omer',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      isVerified: true,
      invitedById: null,
    },
  });
  userId = customer.id;
  const category = await prisma.category.create({
    data: {
      name: { en: 'Sofas', ar: 'كنب' },
      slug: 'sofas',
      parentId: null,
      image: null,
    },
  });
  categoryId = category.id;
});

beforeEach(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.product.deleteMany()]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  // Signed under the fake clock, so `iat`/`exp` are valid relative to the pinned NOW.
  adminToken = signAccessToken(admin);
  customerToken = signAccessToken(customer);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.product.deleteMany()]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('GET /admin/dashboard/summary (ADM-01)', () => {
  it('ADM-01 · aggregates fixed seed data: today, pending, month revenue from DELIVERED, low stock <= 2, latest 5', async () => {
    // Today (Riyadh 2026-11-23): two orders, any status counts.
    await mkOrder({ createdAt: riyadh('2026-11-23T09:00') });
    await mkOrder({ createdAt: riyadh('2026-11-23T08:00'), status: 'CANCELLED' });
    // A PENDING order from yesterday: not today's, but pending.
    await mkOrder({ createdAt: riyadh('2026-11-22T12:00') });
    // Revenue: odd totals catch any rounding; one delivered this month but created last month counts.
    await mkDelivered(riyadh('2026-11-10T12:00'), 10_001);
    await mkDelivered(riyadh('2026-11-05T12:00'), 20_003, riyadh('2026-10-20T12:00'));
    await mkDelivered(riyadh('2026-10-15T12:00'), 50_000); // delivered LAST month: excluded
    await mkOrder({ createdAt: riyadh('2026-11-12T12:00'), status: 'PROCESSING', total: 77_777 }); // not delivered: excluded
    // Low stock: PUBLISHED 0 and 2 count; 3, DRAFT and ARCHIVED do not.
    await mkProduct('PUBLISHED', 0);
    await mkProduct('PUBLISHED', 2);
    await mkProduct('PUBLISHED', 3);
    await mkProduct('DRAFT', 1);
    await mkProduct('ARCHIVED', 0);

    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body.todayOrders).toBe(2);
    expect(res.body.pendingOrders).toBe(2); // one today + one yesterday
    expect(res.body.monthRevenue).toBe(30_004); // 10001 + 20003, exact integer halalas
    expect(Number.isInteger(res.body.monthRevenue)).toBe(true);
    expect(res.body.lowStockCount).toBe(2);

    // Latest 5 of the 7 orders, newest first, in the admin Order shape.
    const latest = res.body.latestOrders as { createdAt: string; user: { id: string } }[];
    expect(latest).toHaveLength(5);
    const times = latest.map((o) => new Date(o.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(latest[0]!.user.id).toBe(userId);
  });

  it('ADM-01 · ordersByDay covers the last 30 Riyadh days, zero-filled, oldest first', async () => {
    await mkOrder({ createdAt: riyadh('2026-11-23T09:00') }); // today
    await mkOrder({ createdAt: riyadh('2026-10-25T00:00') }); // exactly 29 days back: first bucket
    await mkOrder({ createdAt: riyadh('2026-10-24T23:59') }); // 30 days back: outside the window

    const res = await summary();
    expect(res.status).toBe(200);
    const series = res.body.ordersByDay as { date: string; count: number }[];
    expect(series).toHaveLength(30);
    expect(series[0]).toEqual({ date: '2026-10-25', count: 1 });
    expect(series[29]).toEqual({ date: '2026-11-23', count: 1 });
    // Zero-filled in between; the out-of-window order appears nowhere.
    expect(series.reduce((n, d) => n + d.count, 0)).toBe(2);
    expect(series.filter((d) => d.count === 0)).toHaveLength(28);
  });

  it('ADM-01 · Riyadh day boundary: orders at 23:30 and 00:30 Riyadh land on the right days', async () => {
    // 23:30 Riyadh on Nov 22 = 20:30 UTC Nov 22 -> yesterday.
    await mkOrder({ createdAt: new Date('2026-11-22T20:30:00Z') });
    // 00:30 Riyadh on Nov 23 = 21:30 UTC Nov 22 -> TODAY, although the UTC date is still Nov 22.
    await mkOrder({ createdAt: new Date('2026-11-22T21:30:00Z') });

    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body.todayOrders).toBe(1);
    const series = res.body.ordersByDay as { date: string; count: number }[];
    expect(series.find((d) => d.date === '2026-11-22')).toEqual({ date: '2026-11-22', count: 1 });
    expect(series.find((d) => d.date === '2026-11-23')).toEqual({ date: '2026-11-23', count: 1 });
  });

  it('ADM-01 · month revenue uses the DELIVERED event on Riyadh month boundaries', async () => {
    // 23:59 Riyadh on Oct 31 = 20:59 UTC -> last month, excluded.
    await mkDelivered(new Date('2026-10-31T20:59:00Z'), 11_111);
    // 00:30 Riyadh on Nov 1 = 21:30 UTC Oct 31 -> THIS month, included.
    await mkDelivered(new Date('2026-10-31T21:30:00Z'), 22_222);

    const res = await summary();
    expect(res.status).toBe(200);
    expect(res.body.monthRevenue).toBe(22_222);
  });

  it('ADM-01 · 401 without a token, 403 for a customer', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
    expect((await summary(customerToken)).status).toBe(403);
  });
});
