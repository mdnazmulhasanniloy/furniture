import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_notifications_api_t016',
  );
});

import type { User } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let customer: User;
let other: User;
let admin: User;
let customerToken = '';
let adminToken = '';
let seq = 0;

const mkUser = (role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER') => {
  seq += 1;
  return prisma.user.create({
    data: {
      firstName: 'Noti',
      lastName: 'Fied',
      email: `notif-${seq}@example.com`,
      passwordHash: 'x',
      isVerified: true,
      role,
    },
  });
};

/** Writes explicit nulls like the T-016 consumers (rule 8). */
const mkNotif = (userId: string, overrides: { readAt?: Date | null; createdAt?: Date } = {}) => {
  seq += 1;
  return prisma.notification.create({
    data: {
      userId,
      type: 'ORDER_STATUS',
      title: { en: `Order update ${seq}`, ar: `تحديث الطلب ${seq}` },
      body: {
        en: `Your order FX-${seq} is now Confirmed.`,
        ar: `أصبحت حالة طلبك FX-${seq}: تم التأكيد.`,
      },
      link: `/orders/aaaaaaaaaaaaaaaaaaaaaaa${seq % 10}`,
      data: { orderId: `aaaaaaaaaaaaaaaaaaaaaaa${seq % 10}`, orderNo: `FX-${seq}` },
      readAt: overrides.readAt ?? null,
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
    },
  });
};

interface ListBody {
  items: { id: string; readAt: string | null; createdAt: string; data: unknown; link: unknown }[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  unread: number;
}

const list = (token: string, query = '') =>
  request(app).get(`/api/v1/notifications${query}`).set(auth(token));

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});

beforeEach(async () => {
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
  customer = await mkUser();
  other = await mkUser();
  admin = await mkUser('ADMIN');
  customerToken = signAccessToken(customer);
  adminToken = signAccessToken(admin);
});

afterAll(async () => {
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('NOTIF-03 · notifications list / read / read-all (T-016)', () => {
  it('NOTIF-03 · GET /notifications paginates newest-first with meta and the unread count, own rows only', async () => {
    const oldest = await mkNotif(customer.id, { createdAt: new Date(Date.now() - 3000) });
    const middle = await mkNotif(customer.id, {
      createdAt: new Date(Date.now() - 2000),
      readAt: new Date(),
    });
    const newest = await mkNotif(customer.id, { createdAt: new Date(Date.now() - 1000) });
    const foreign = await mkNotif(other.id);

    const res = await list(customerToken, '?limit=2').expect(200);
    const body = res.body as ListBody;
    expect(body.items.map((i) => i.id)).toEqual([newest.id, middle.id]);
    expect(body.meta).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(body.unread).toBe(2); // the read `middle` row does not count
    expect(body.items[0]!.readAt).toBeNull();
    expect(body.items[0]!.link).toMatch(/^\/orders\//);
    expect(body.items[0]!.data).toMatchObject({ orderNo: expect.stringContaining('FX-') });

    const page2 = (await list(customerToken, '?limit=2&page=2').expect(200)).body as ListBody;
    expect(page2.items.map((i) => i.id)).toEqual([oldest.id]);
    // The other user's row never appears in any page.
    expect([...body.items, ...page2.items].map((i) => i.id)).not.toContain(foreign.id);
  });

  it('NOTIF-03 · limit defaults to 20 and is capped at 50 (owner 2026-11-22)', async () => {
    const def = (await list(customerToken).expect(200)).body as ListBody;
    expect(def.meta.limit).toBe(20);
    const max = (await list(customerToken, '?limit=50').expect(200)).body as ListBody;
    expect(max.meta.limit).toBe(50);
    const over = await list(customerToken, '?limit=51').expect(422);
    expect(over.body.code).toBe('VALIDATION_ERROR');
  });

  it('NOTIF-03 · mark-one-read: 204, readAt set, unread decrements; a repeat is 204 and readAt unchanged', async () => {
    const row = await mkNotif(customer.id);
    await mkNotif(customer.id);
    await request(app)
      .patch(`/api/v1/notifications/${row.id}/read`)
      .set(auth(customerToken))
      .expect(204);
    const read = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(read.readAt).toBeInstanceOf(Date);
    expect(((await list(customerToken).expect(200)).body as ListBody).unread).toBe(1);

    // Idempotent: 204 again, the original readAt is not overwritten.
    await request(app)
      .patch(`/api/v1/notifications/${row.id}/read`)
      .set(auth(customerToken))
      .expect(204);
    const again = await prisma.notification.findUniqueOrThrow({ where: { id: row.id } });
    expect(again.readAt!.getTime()).toBe(read.readAt!.getTime());
  });

  it('NOTIF-03 · a foreign, unknown or malformed id is the same 404 (ownership never revealed)', async () => {
    const foreign = await mkNotif(other.id);
    for (const id of [foreign.id, 'ffffffffffffffffffffffff', 'not-an-objectid']) {
      const res = await request(app)
        .patch(`/api/v1/notifications/${id}/read`)
        .set(auth(customerToken))
        .expect(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.requestId).toBeTruthy();
    }
    // The foreign row was not touched.
    const untouched = await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.readAt).toBeNull();
  });

  it("NOTIF-03 · read-all marks all of the caller's unread rows read (204, unread 0) and nobody else's", async () => {
    await mkNotif(customer.id);
    await mkNotif(customer.id);
    const foreign = await mkNotif(other.id);
    await request(app).post('/api/v1/notifications/read-all').set(auth(customerToken)).expect(204);
    expect(((await list(customerToken).expect(200)).body as ListBody).unread).toBe(0);
    expect(
      await prisma.notification.count({ where: { userId: customer.id, readAt: { not: null } } }),
    ).toBe(2);
    expect(
      (await prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt,
    ).toBeNull();
  });

  it('NOTIF-03 · rule 8 regression: a row stored WITHOUT readAt counts as unread and read-all catches it', async () => {
    // Raw insert so the document has no readAt field at all (not even an explicit null).
    await prisma.$runCommandRaw({
      insert: 'Notification',
      documents: [
        {
          userId: { $oid: customer.id },
          type: 'SYSTEM',
          title: { en: 'Legacy', ar: 'قديم' },
          body: { en: 'Written without readAt', ar: 'بدون حقل القراءة' },
          createdAt: { $date: new Date().toISOString() },
        },
      ],
    });
    const raw = await prisma.notification.findRaw({ filter: { readAt: { $exists: false } } });
    expect(raw).toHaveLength(1); // precondition: the field really is missing

    const body = (await list(customerToken).expect(200)).body as ListBody;
    expect(body.unread).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.readAt).toBeNull();

    // Both read paths must match the missing field: mark-one ...
    await request(app)
      .patch(`/api/v1/notifications/${body.items[0]!.id}/read`)
      .set(auth(customerToken))
      .expect(204);
    // ... and read-all (re-create the fieldless document).
    await prisma.notification.deleteMany();
    await prisma.$runCommandRaw({
      insert: 'Notification',
      documents: [
        {
          userId: { $oid: customer.id },
          type: 'SYSTEM',
          title: { en: 'Legacy 2', ar: 'قديم ٢' },
          body: { en: 'Again without readAt', ar: 'مرة أخرى بدون الحقل' },
          createdAt: { $date: new Date().toISOString() },
        },
      ],
    });
    await request(app).post('/api/v1/notifications/read-all').set(auth(customerToken)).expect(204);
    expect(await prisma.notification.count({ where: { readAt: { not: null } } })).toBe(1);
  });

  it('NOTIF-03 · all three endpoints are 401 without a valid token', async () => {
    await request(app).get('/api/v1/notifications').expect(401);
    await request(app).patch('/api/v1/notifications/ffffffffffffffffffffffff/read').expect(401);
    await request(app).post('/api/v1/notifications/read-all').expect(401);
  });

  it('ADM-10 · an admin lists their own notifications through the same endpoint', async () => {
    await prisma.notification.create({
      data: {
        userId: admin.id,
        type: 'NEW_ORDER',
        title: { en: 'New order', ar: 'طلب جديد' },
        body: { en: 'Order FX-1 was placed.', ar: 'تم تقديم الطلب FX-1.' },
        link: null,
        data: null,
        readAt: null,
      },
    });
    await mkNotif(customer.id); // a customer's row must not leak into the admin's list
    const body = (await list(adminToken).expect(200)).body as ListBody;
    expect(body.items).toHaveLength(1);
    expect(body.unread).toBe(1);
    expect((body.items[0] as { type?: string }).type).toBe('NEW_ORDER');
  });
});
