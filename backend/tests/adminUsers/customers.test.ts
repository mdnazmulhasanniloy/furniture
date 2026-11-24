import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_adminusers_t017a',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { expectNoSecretKeys } from '../helpers/noSecrets.js';

const app = createApp();
const BASE = '/api/v1/admin/customers';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let hash = '';
let adminToken = '';
let adminId = '';
let customerToken = '';

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Alharbi',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      isVerified: true,
      phone: null,
      invitedById: null,
      ...over,
    },
  });

const mkOrder = (uid: string) =>
  prisma.order.create({
    data: {
      orderNo: `FX-20260101-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
      userId: uid,
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
      subtotal: 0,
      deliveryFee: 0,
      vat: {
        vatRate: 0,
        vatAmount: 0,
        applyToDelivery: true,
        pricesIncludeVat: true,
        registrationNumber: null,
      },
      total: 0,
      customerNote: null,
      adminNote: null,
    },
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne!');
});

beforeEach(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.refreshToken.deleteMany()]);
  await prisma.user.deleteMany();
  const admin = await mkUser({ role: 'ADMIN', firstName: 'Admin', lastName: 'One' });
  adminId = admin.id;
  adminToken = signAccessToken(admin);
  const customer = await mkUser({ firstName: 'Cust', lastName: 'Omer' });
  customerToken = signAccessToken(customer);
});

afterAll(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.refreshToken.deleteMany()]);
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('GET /admin/customers (ADM-05)', () => {
  it('ADM-05 · list returns only customers with orderCount, newest first, paginated', async () => {
    const older = await mkUser({ firstName: 'Older', createdAt: new Date('2026-01-01') });
    const newer = await mkUser({ firstName: 'Newer', createdAt: new Date('2026-06-01') });
    await mkOrder(newer.id);
    await mkOrder(newer.id);

    const res = await request(app).get(BASE).set(auth(adminToken));
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string; orderCount: number; role: string }[];
    // The admin is absent; every row is a CUSTOMER.
    expect(items.some((u) => u.id === adminId)).toBe(false);
    expect(items.every((u) => u.role === 'CUSTOMER')).toBe(true);
    // Newest first, counts correct incl. 0.
    const iNewer = items.findIndex((u) => u.id === newer.id);
    const iOlder = items.findIndex((u) => u.id === older.id);
    expect(iNewer).toBeGreaterThanOrEqual(0);
    expect(iNewer).toBeLessThan(iOlder);
    expect(items.find((u) => u.id === newer.id)!.orderCount).toBe(2);
    expect(items.find((u) => u.id === older.id)!.orderCount).toBe(0);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 24, total: 3 });
    expectNoSecretKeys(res.body);

    // Pagination.
    const page2 = await request(app).get(`${BASE}?page=2&limit=2`).set(auth(adminToken));
    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.meta).toMatchObject({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('ADM-05 · q matches email and first/last name case-insensitively', async () => {
    const target = await mkUser({
      email: 'layla.saud@example.com',
      firstName: 'Layla',
      lastName: 'Saud',
    });
    await mkUser({ firstName: 'Other', lastName: 'User' });

    for (const q of ['LAYLA.SAUD@EXAMPLE', 'layla', 'sAUd']) {
      const res = await request(app).get(BASE).query({ q }).set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(res.body.items.map((u: { id: string }) => u.id)).toEqual([target.id]);
    }
  });

  it('ADM-05 · "." and "(" in q are matched literally (rule 9), and q over 100 chars -> 422', async () => {
    const dot = await mkUser({ email: 'dot.user@example.com', firstName: 'Dot' });
    // Would match "dot.user" too if the "." were a regex wildcard.
    await mkUser({ email: 'dotxuser@example.com', firstName: 'DotX' });

    const literal = await request(app).get(BASE).query({ q: 'dot.' }).set(auth(adminToken));
    expect(literal.status).toBe(200);
    expect(literal.body.items.map((u: { id: string }) => u.id)).toEqual([dot.id]);

    // "(" is literal too: no 500 from an invalid regex, just an empty page.
    const paren = await request(app).get(BASE).query({ q: '(' }).set(auth(adminToken));
    expect(paren.status).toBe(200);
    expect(paren.body.items).toEqual([]);

    const tooLong = await request(app)
      .get(BASE)
      .query({ q: 'x'.repeat(101) })
      .set(auth(adminToken));
    expect(tooLong.status).toBe(422);
    expect(tooLong.body.code).toBe('VALIDATION_ERROR');
  });

  it('ADM-05 · q that normalises to a Saudi mobile matches the exact stored phone (incl. Arabic-Indic digits)', async () => {
    const target = await mkUser({ phone: '+966551234567', firstName: 'Phoned' });
    await mkUser({ phone: '+966559999999' });

    for (const q of ['055 123 4567', '٠٥٥١٢٣٤٥٦٧', '+966551234567']) {
      const res = await request(app).get(BASE).query({ q }).set(auth(adminToken));
      expect(res.status).toBe(200);
      expect(
        res.body.items.map((u: { id: string }) => u.id),
        `q=${q}`,
      ).toEqual([target.id]);
    }
  });
});

describe('GET /admin/customers/{id} (ADM-05)', () => {
  it('ADM-05 · detail returns the user and their orders newest first with meta', async () => {
    const customer = await mkUser({ firstName: 'Detail' });
    const first = await mkOrder(customer.id);
    await prisma.order.update({
      where: { id: first.id },
      data: { createdAt: new Date('2026-01-01') },
    });
    const second = await mkOrder(customer.id);
    await mkOrder((await mkUser()).id); // someone else's order never shows

    const res = await request(app).get(`${BASE}/${customer.id}?limit=1`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(customer.id);
    expect(res.body.orders).toHaveLength(1);
    expect(res.body.orders[0].id).toBe(second.id);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
    expectNoSecretKeys(res.body);
  });

  it('ADM-05 · unknown, malformed and admin ids -> 404', async () => {
    for (const id of ['ffffffffffffffffffffffff', 'not-an-id', adminId]) {
      const res = await request(app).get(`${BASE}/${id}`).set(auth(adminToken));
      expect(res.status, id).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });
});

describe('auth guards (ADM-05 / ADM-11)', () => {
  it('ADM-05 · 401 without a token, 403 for a customer, on both routers', async () => {
    for (const path of [BASE, '/api/v1/admin/admins']) {
      const anon = await request(app).get(path);
      expect(anon.status, path).toBe(401);
      const customer = await request(app).get(path).set(auth(customerToken));
      expect(customer.status, path).toBe(403);
    }
    const invite = await request(app)
      .post('/api/v1/admin/admins')
      .set(auth(customerToken))
      .send({ firstName: 'A', lastName: 'B', email: 'x@example.com' });
    expect(invite.status).toBe(403);
  });
});
