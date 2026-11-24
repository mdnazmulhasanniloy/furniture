import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_adminusers_adm17',
  );
});

import { createApp } from '../../src/app.js';
import { mailer } from '../../src/emails/mailer.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken, UNREVOKED } from '../../src/lib/tokens.js';
import * as service from '../../src/modules/adminUsers/service.js';
import { expectNoSecretKeys } from '../helpers/noSecrets.js';

// ADM-17 (CR-011): customer management. Every rule of the brief has a test here, authz included.

const app = createApp();
const BASE = '/api/v1/admin/customers';
const PASSWORD = 'Passw0rdOne';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let hash = '';
let admin: Awaited<ReturnType<typeof mkUser>>;
let adminToken = '';

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Alharbi',
      email: `${randomUUID()}@example.com`,
      passwordHash: hash,
      isVerified: true,
      phone: '+966551234567',
      invitedById: null,
      ...over,
    },
  });

const mkOrder = (userId: string, status = 'DELIVERED') =>
  prisma.order.create({
    data: {
      orderNo: `FX-20260101-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
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
      subtotal: 0,
      deliveryFee: 0,
      vat: { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      total: 0,
      customerNote: null,
      adminNote: null,
      status: status as never,
    },
  });

const block = (id: string, body: unknown, token = adminToken) =>
  request(app).patch(`${BASE}/${id}/block`).set(auth(token)).send(body as object);
const edit = (id: string, body: unknown, token = adminToken) =>
  request(app).patch(`${BASE}/${id}`).set(auth(token)).send(body as object);
const remove = (id: string, body: unknown, token = adminToken) =>
  request(app).delete(`${BASE}/${id}`).set(auth(token)).send(body as object);
const stamp = (u: { updatedAt: Date }) => u.updatedAt.toISOString();
const rawDoc = async (id: string) => {
  const res = (await prisma.user.findRaw({ filter: { _id: { $oid: id } } })) as unknown as Record<string, unknown>[];
  return res[0]!;
};

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', { env: { ...process.env }, stdio: 'pipe' });
  hash = await hashPassword(PASSWORD);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.refreshToken.deleteMany(),
    prisma.address.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.wishlist.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.otp.deleteMany(),
  ]);
  await prisma.user.deleteMany();
  admin = await mkUser({ role: 'ADMIN', firstName: 'Admin', lastName: 'One', phone: null });
  adminToken = signAccessToken(admin);
});

afterAll(async () => {
  await Promise.all([prisma.order.deleteMany(), prisma.refreshToken.deleteMany()]);
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-17 · block with a required reason', () => {
  it('ADM-17 · blocking without a reason, or with one outside 3 to 300 characters, is 422 and changes nothing', async () => {
    const c = await mkUser();
    for (const body of [{ isBlocked: true }, { isBlocked: true, reason: '  ' }, { isBlocked: true, reason: 'ab' }, { isBlocked: true, reason: 'x'.repeat(301) }]) {
      const res = await block(c.id, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).isBlocked).toBe(false);
  });

  it('ADM-17 · a block stores the reason, when and by whom, and the admin sees them', async () => {
    const c = await mkUser();
    const res = await block(c.id, { isBlocked: true, reason: '  Repeated fake orders  ' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isBlocked: true, blockedReason: 'Repeated fake orders', blockedById: admin.id });
    expect(typeof res.body.blockedAt).toBe('string');
    const detail = await request(app).get(`${BASE}/${c.id}`).set(auth(adminToken));
    expect(detail.body.user).toMatchObject({ isBlocked: true, blockedReason: 'Repeated fake orders' });
    expectNoSecretKeys(res.body);
  });

  it('ADM-17 · the reason is admin-only: the customer-facing user shape never carries it', async () => {
    const c = await mkUser({ blockedReason: 'internal note', blockedAt: new Date(), blockedById: admin.id });
    const me = await request(app).get('/api/v1/auth/me').set(auth(signAccessToken(c)));
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).not.toContain('internal note');
    expect(me.body).not.toHaveProperty('blockedReason');
    expect(me.body).not.toHaveProperty('blockedById');
  });

  it('ADM-17 · blocking revokes every refresh token and disconnects the live sockets', async () => {
    const c = await mkUser();
    const mk = () =>
      prisma.refreshToken.create({
        data: { userId: c.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 864e5), revokedAt: null, rotatedAt: null, userAgent: null },
      });
    await Promise.all([mk(), mk(), mk()]);
    const spy = vi.spyOn(socketEmitter, 'disconnectUser').mockImplementation(() => {});
    expect((await block(c.id, { isBlocked: true, reason: 'Abuse of returns' })).status).toBe(200);
    expect(await prisma.refreshToken.count({ where: { userId: c.id, ...UNREVOKED } })).toBe(0);
    expect(spy).toHaveBeenCalledWith(c.id);
  });

  it('ADM-17 · a blocked customer cannot log in, refresh, reset a password or place an order, and sees one generic response', async () => {
    const c = await mkUser();
    const token = signAccessToken(c);
    expect((await block(c.id, { isBlocked: true, reason: 'Secret internal reason' })).status).toBe(200);

    const login = await request(app).post('/api/v1/auth/login').send({ email: c.email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('ACCOUNT_BLOCKED');
    expect(JSON.stringify(login.body)).not.toContain('Secret internal reason');

    const refresh = await request(app).post('/api/v1/auth/refresh');
    expect([401, 403]).toContain(refresh.status); // no valid session either way

    const send = vi.spyOn(mailer, 'send').mockResolvedValue(undefined as never);
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: c.email });
    expect(forgot.status).toBe(200); // same answer as for any address: no enumeration
    expect(send).not.toHaveBeenCalled(); // no email is sent (the stored row is an anti-enumeration decoy nobody knows the code of)
    const reset = await request(app).post('/api/v1/auth/reset-password').send({ email: c.email, code: '123456', newPassword: 'Passw0rdTwo' });
    expect(reset.status).toBe(400); // no code can complete a reset
    expect(reset.body.code).toBe('OTP_INVALID');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).passwordHash).toBe(hash);

    const order = await request(app).post('/api/v1/orders').set(auth(token)).set('Idempotency-Key', randomUUID()).send({});
    expect(order.status).toBe(401); // requireAuth rejects the blocked user's still-valid access token
    expect(JSON.stringify(order.body)).not.toContain('Secret internal reason');
    expect(await prisma.order.count({ where: { userId: c.id } })).toBe(0);
  });

  it('ADM-17 · unblocking clears the blocked fields to an explicit null, accepts an optional reason and restores login', async () => {
    const c = await mkUser();
    await block(c.id, { isBlocked: true, reason: 'Chargebacks' });
    const res = await block(c.id, { isBlocked: false, reason: 'Resolved by phone' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isBlocked: false, blockedReason: null, blockedAt: null, blockedById: null });
    const doc = await rawDoc(c.id);
    for (const k of ['blockedReason', 'blockedAt', 'blockedById']) expect(doc, k).toHaveProperty(k, null); // explicit null, not missing (rule 8)
    expect(JSON.stringify(doc)).not.toContain('Resolved by phone'); // the optional unblock reason is not stored
    const login = await request(app).post('/api/v1/auth/login').send({ email: c.email, password: PASSWORD });
    expect(login.status).toBe(200);
  });
});

describe('ADM-17 · update name and phone only', () => {
  it('ADM-17 · an admin edits first name, last name and phone; the phone is normalised to +9665XXXXXXXX', async () => {
    const c = await mkUser();
    const res = await edit(c.id, { expectedUpdatedAt: stamp(c), firstName: ' Noura ', lastName: 'Alotaibi', phone: '0555123456' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: 'Noura', lastName: 'Alotaibi', phone: '+966555123456' });
    expectNoSecretKeys(res.body);
    const again = await edit(c.id, { expectedUpdatedAt: res.body.updatedAt, phone: '+966 55 987 6543' });
    expect(again.body.phone).toBe('+966559876543');
  });

  it('ADM-17 · phone null clears it to an explicit null', async () => {
    const c = await mkUser();
    const res = await edit(c.id, { expectedUpdatedAt: stamp(c), phone: null });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
    expect(await rawDoc(c.id)).toHaveProperty('phone', null);
  });

  it('ADM-17 · any other field is 422: email, password, role, isBlocked, isVerified, avatar, unknown keys', async () => {
    const c = await mkUser();
    for (const extra of [{ email: 'x@example.com' }, { password: 'Passw0rdTwo' }, { passwordHash: 'x' }, { role: 'ADMIN' }, { isBlocked: true }, { isVerified: false }, { avatar: 'k' }, { foo: 1 }]) {
      const res = await edit(c.id, { expectedUpdatedAt: stamp(c), firstName: 'Ok', ...extra });
      expect(res.status, JSON.stringify(extra)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(fresh).toMatchObject({ firstName: 'Sara', email: c.email, role: 'CUSTOMER', isBlocked: false });
    expect(fresh.passwordHash).toBe(hash);
  });

  it('ADM-17 · an empty change, a non-Saudi phone, a landline and an over-long name are 422', async () => {
    const c = await mkUser();
    expect((await edit(c.id, { expectedUpdatedAt: stamp(c) })).status).toBe(422);
    expect((await edit(c.id, { expectedUpdatedAt: stamp(c), phone: '+971501234567' })).status).toBe(422);
    expect((await edit(c.id, { expectedUpdatedAt: stamp(c), phone: '0112345678' })).status).toBe(422);
    expect((await edit(c.id, { expectedUpdatedAt: stamp(c), firstName: 'x'.repeat(41) })).status).toBe(422);
    expect((await edit(c.id, { firstName: 'NoToken' })).status).toBe(422); // expectedUpdatedAt is required
  });

  it('ADM-17 · a stale expectedUpdatedAt is 409 STALE_UPDATE with the current customer, and writes nothing', async () => {
    const c = await mkUser();
    const first = await edit(c.id, { expectedUpdatedAt: stamp(c), firstName: 'First' });
    expect(first.status).toBe(200);
    const stale = await edit(c.id, { expectedUpdatedAt: stamp(c), firstName: 'Second' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
    expect(stale.body.details.current.firstName).toBe('First');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).firstName).toBe('First');
  });
});

describe('ADM-17 · an admin can never touch an admin or themselves', () => {
  it('ADM-17 · block, edit and delete on the caller own id are 403 FORBIDDEN_TARGET and change nothing', async () => {
    for (const res of [
      await block(admin.id, { isBlocked: true, reason: 'Self block' }),
      await edit(admin.id, { expectedUpdatedAt: stamp(admin), firstName: 'Mine' }),
      await remove(admin.id, { confirmEmail: admin.email }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_TARGET');
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ firstName: 'Admin', isBlocked: false });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).deletedAt ?? null).toBeNull();
  });

  it('ADM-17 · block, edit and delete on ANOTHER admin are 404 and change nothing', async () => {
    const other = await mkUser({ role: 'ADMIN', firstName: 'Other' });
    expect((await block(other.id, { isBlocked: true, reason: 'No way' })).status).toBe(404);
    expect((await edit(other.id, { expectedUpdatedAt: stamp(other), firstName: 'Hacked' })).status).toBe(404);
    expect((await remove(other.id, { confirmEmail: other.email })).status).toBe(404);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ firstName: 'Other', isBlocked: false, email: other.email });
  });

  it('ADM-17 · unknown and malformed ids are 404', async () => {
    expect((await block('not-an-id', { isBlocked: true, reason: 'abc' })).status).toBe(404);
    expect((await edit('0'.repeat(24), { expectedUpdatedAt: new Date().toISOString(), firstName: 'A' })).status).toBe(404);
    expect((await remove('0'.repeat(24), { confirmEmail: 'a@b.co' })).status).toBe(404);
  });

  it('ADM-17 · non-admins and anonymous callers are refused on all three routes', async () => {
    const c = await mkUser();
    const other = await mkUser();
    const customerToken = signAccessToken(c);
    for (const t of [customerToken, '']) {
      const headers = t ? auth(t) : {};
      const b = await request(app).patch(`${BASE}/${other.id}/block`).set(headers).send({ isBlocked: true, reason: 'abc' });
      const e = await request(app).patch(`${BASE}/${other.id}`).set(headers).send({ expectedUpdatedAt: stamp(other), firstName: 'A' });
      const d = await request(app).delete(`${BASE}/${other.id}`).set(headers).send({ confirmEmail: other.email });
      for (const res of [b, e, d]) expect(res.status).toBe(t ? 403 : 401);
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ isBlocked: false, firstName: 'Sara' });
  });
});

describe('ADM-17 · soft delete with anonymisation', () => {
  it('ADM-17 · the admin must send the exact customer email: a wrong one is 422 CONFIRM_EMAIL_MISMATCH, a case difference is accepted', async () => {
    const c = await mkUser();
    const bad = await remove(c.id, { confirmEmail: 'someone-else@example.com' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('CONFIRM_EMAIL_MISMATCH');
    expect((await remove(c.id, {})).status).toBe(422);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).deletedAt ?? null).toBeNull();
    expect((await remove(c.id, { confirmEmail: c.email.toUpperCase() })).status).toBe(200);
  });

  it('ADM-17 · a customer with a PENDING or CONFIRMED order cannot be deleted (409 CUSTOMER_HAS_OPEN_ORDERS); finished orders do not block', async () => {
    const pending = await mkUser();
    await mkOrder(pending.id, 'PENDING');
    const confirmed = await mkUser();
    await mkOrder(confirmed.id, 'CONFIRMED');
    for (const c of [pending, confirmed]) {
      const res = await remove(c.id, { confirmEmail: c.email });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_HAS_OPEN_ORDERS');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).email).toBe(c.email); // untouched
    }
    const done = await mkUser();
    await mkOrder(done.id, 'DELIVERED');
    await mkOrder(done.id, 'CANCELLED');
    expect((await remove(done.id, { confirmEmail: done.email })).status).toBe(200);
  });

  it('ADM-17 · delete anonymises every listed field, keeps the orders and frees the email', async () => {
    const c = await mkUser({ avatar: null, failedLoginCount: 2 });
    await prisma.address.create({ data: { userId: c.id, label: 'Home', fullName: 'Sara Ali', phone: '+966551234567', cityCode: 'riyadh', area: 'Olaya', street: 'King Fahd Rd', notes: null, isDefault: true } });
    await prisma.cart.create({ data: { userId: c.id, items: [{ productId: '1'.repeat(24), qty: 1, priceSeen: 100 }] } });
    await prisma.wishlist.create({ data: { userId: c.id, productIds: ['1'.repeat(24)] } });
    await prisma.notification.create({ data: { userId: c.id, type: 'SYSTEM', title: { en: 't', ar: 'ع' }, body: { en: 'b', ar: 'ج' }, link: null, readAt: null } });
    await prisma.otp.create({ data: { email: c.email, purpose: 'RESET_PASSWORD', codeHash: 'x', expiresAt: new Date(Date.now() + 60_000), consumedAt: null } });
    await prisma.refreshToken.create({ data: { userId: c.id, familyId: randomUUID(), tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 864e5), revokedAt: null, rotatedAt: null, userAgent: null } });
    const order = await mkOrder(c.id, 'DELIVERED');
    const spy = vi.spyOn(socketEmitter, 'disconnectUser').mockImplementation(() => {});

    const res = await remove(c.id, { confirmEmail: c.email });
    expect(res.status).toBe(200);
    expectNoSecretKeys(res.body);
    expect(res.body).toMatchObject({ firstName: 'Deleted', lastName: 'customer', email: `deleted-${c.id}@deleted.invalid`, phone: null, isBlocked: true, deletedById: admin.id });
    expect(typeof res.body.deletedAt).toBe('string');

    const user = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
    expect(user.passwordHash).not.toBe(hash);
    expect(user.avatar).toBeNull();
    // no personal data is left anywhere on the account
    expect(JSON.stringify(res.body) + JSON.stringify({ ...user, passwordHash: '' })).not.toContain(c.email);
    expect(JSON.stringify(res.body)).not.toContain('Sara');
    expect(JSON.stringify(res.body)).not.toContain('Alharbi');
    expect(JSON.stringify(res.body)).not.toContain('551234567');

    expect(await prisma.address.count({ where: { userId: c.id } })).toBe(0);
    expect(await prisma.cart.count({ where: { userId: c.id } })).toBe(0);
    expect(await prisma.wishlist.count({ where: { userId: c.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: c.id } })).toBe(0);
    expect(await prisma.otp.count({ where: { email: c.email } })).toBe(0);
    expect(await prisma.refreshToken.count({ where: { userId: c.id, ...UNREVOKED } })).toBe(0);
    expect(spy).toHaveBeenCalledWith(c.id);

    // the order and its address snapshot are kept (sales and VAT record)
    const kept = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(kept.userId).toBe(c.id);
    expect(kept.address).toMatchObject({ fullName: 'Sara Ali', street: 'King Fahd Rd 12' });

    // the real email is free: the person can register again
    await expect(mkUser({ email: c.email })).resolves.toBeTruthy();
    // and the old credentials no longer work
    const login = await request(app).post('/api/v1/auth/login').send({ email: `deleted-${c.id}@deleted.invalid`, password: PASSWORD });
    expect(login.status).toBeGreaterThanOrEqual(400);
  });

  it('ADM-17 · a deleted customer cannot be blocked, edited or deleted again (409 CUSTOMER_DELETED) and no stale token works', async () => {
    const c = await mkUser();
    const token = signAccessToken(c);
    expect((await remove(c.id, { confirmEmail: c.email })).status).toBe(200);
    const stamp2 = (await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).updatedAt.toISOString();
    for (const res of [
      await block(c.id, { isBlocked: false }),
      await edit(c.id, { expectedUpdatedAt: stamp2, firstName: 'Again' }),
      await remove(c.id, { confirmEmail: `deleted-${c.id}@deleted.invalid` }),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CUSTOMER_DELETED');
    }
    expect((await request(app).get('/api/v1/auth/me').set(auth(token))).status).toBe(401);
  });
});

describe('ADM-17 · list status filter', () => {
  it('ADM-17 · by default deleted customers are hidden; active, blocked and deleted filter exactly', async () => {
    const active = await mkUser({ firstName: 'Active' });
    const blocked = await mkUser({ firstName: 'Blocked', isBlocked: true, blockedReason: 'abc', blockedAt: new Date(), blockedById: admin.id });
    const gone = await mkUser({ firstName: 'Gone' });
    await remove(gone.id, { confirmEmail: gone.email });
    const ids = async (qs: string) =>
      ((await request(app).get(`${BASE}${qs}`).set(auth(adminToken))).body.items as { id: string }[]).map((i) => i.id).sort();
    expect(await ids('')).toEqual([active.id, blocked.id].sort());
    expect(await ids('?status=active')).toEqual([active.id]);
    expect(await ids('?status=blocked')).toEqual([blocked.id]); // a deleted customer is blocked too, but is never listed as blocked
    expect(await ids('?status=deleted')).toEqual([gone.id]);
    expect((await request(app).get(`${BASE}?status=nope`).set(auth(adminToken))).status).toBe(422);
    const deleted = (await request(app).get(`${BASE}?status=deleted`).set(auth(adminToken))).body.items[0];
    expect(deleted).toMatchObject({ isBlocked: true, deletedById: admin.id });
    expectNoSecretKeys(deleted);
  });

  it('ADM-17 · rule 8: a customer document created WITHOUT the new fields still counts as not deleted', async () => {
    const legacy = await mkUser({ firstName: 'Legacy' }); // Prisma omits unset optional fields: they are missing, not null
    const doc = await rawDoc(legacy.id);
    expect(doc).not.toHaveProperty('deletedAt');
    expect((await request(app).get(BASE).set(auth(adminToken))).body.items.map((i: { id: string }) => i.id)).toContain(legacy.id);
    expect((await request(app).get(`${BASE}?status=active`).set(auth(adminToken))).body.items.map((i: { id: string }) => i.id)).toContain(legacy.id);
    expect((await request(app).get(`${BASE}?status=deleted`).set(auth(adminToken))).body.items.map((i: { id: string }) => i.id)).not.toContain(legacy.id);
  });

  it('ADM-17 · search still works together with the status filter and every row is free of secrets', async () => {
    const a = await mkUser({ firstName: 'Zainab' });
    await mkUser({ firstName: 'Other', isBlocked: true });
    const res = await request(app).get(`${BASE}?q=zain&status=active`).set(auth(adminToken));
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expectNoSecretKeys(res.body);
  });
});

describe('ADM-17 · one audit log line per action, without personal data', () => {
  const lines = () => {
    const info = vi.fn();
    return { info, log: { info } as never };
  };
  const personal = (c: { email: string }) => [c.email, 'Sara', 'Alharbi', '551234567', 'Secret reason text'];

  it('ADM-17 · block, unblock, update and delete each log exactly one line with actor, target, action and field names only', async () => {
    const c = await mkUser();
    const { info, log } = lines();
    const requestId = 'req-1';
    await service.blockCustomer(admin, c.id, { isBlocked: true, reason: 'Secret reason text' }, { log, requestId });
    await service.blockCustomer(admin, c.id, { isBlocked: false }, { log, requestId });
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: c.id } });
    await service.updateCustomer(admin, c.id, { expectedUpdatedAt: fresh.updatedAt, firstName: 'Changed', phone: null }, { log, requestId });
    await service.deleteCustomer(admin, c.id, { confirmEmail: c.email }, { log, requestId });
    expect(info).toHaveBeenCalledTimes(4);
    const events = info.mock.calls.map((call) => (call[0] as { event: string }).event);
    expect(events).toEqual(['customer.block', 'customer.unblock', 'customer.update', 'customer.delete']);
    for (const [obj, msg] of info.mock.calls as [Record<string, unknown>, string][]) {
      expect(obj).toMatchObject({ actorId: admin.id, targetId: c.id, requestId });
      expect(typeof obj.at).toBe('string');
      expect(Array.isArray(obj.fields)).toBe(true);
      expect(msg).toBe(obj.event);
      const dump = JSON.stringify([obj, msg]);
      for (const secret of personal(c)) expect(dump, secret).not.toContain(secret);
    }
    expect((info.mock.calls[2]![0] as { fields: string[] }).fields).toEqual(['firstName', 'phone']); // names, never values
  });

  it('ADM-17 · a refused action logs nothing (no audit line for a 4xx)', async () => {
    const c = await mkUser();
    const { info, log } = lines();
    await expect(service.blockCustomer(admin, admin.id, { isBlocked: true, reason: 'abc' }, { log })).rejects.toMatchObject({ code: 'FORBIDDEN_TARGET' });
    await expect(service.deleteCustomer(admin, c.id, { confirmEmail: 'wrong@example.com' }, { log })).rejects.toMatchObject({ code: 'CONFIRM_EMAIL_MISMATCH' });
    expect(info).not.toHaveBeenCalled();
  });
});
