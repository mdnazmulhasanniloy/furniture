import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_conformance_t019',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { setTransport } from '../../src/emails/mailer.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { s3State } from '../helpers/s3Mock.js';
import {
  Conformance,
  ConformanceError,
  expressRoutes,
  loadSpec,
  mountedPath,
  specOperations,
} from './openapi.js';

/**
 * T-019 (NFR-01) spec conformance: every operation documented in api-spec.yaml is exercised and every
 * received response is validated against the documented schema (body + status). The harness also fails
 * on any 5xx, on any undocumented status, and on any 4xx body that is not the Error schema with a
 * requestId (owner additions b + c). The `it` blocks run in file order and share state like one long
 * user session; the final tests assert coverage in both directions.
 */

const CRON_SECRET = 'test-cron-secret-0123456789abcdefghij';
const app = createApp({ env: { ...getEnv(), CRON_SECRET } });
const conf = new Conformance();
const sendMail = vi.fn().mockResolvedValue({});

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface CallOpts {
  /** Concrete path when the spec path has `{params}`. */
  path?: string;
  status: number;
  token?: string;
  cookie?: string;
  csrf?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

async function call(method: Method, specPath: string, opts: CallOpts): Promise<Response> {
  let r = request(app)[method](mountedPath(opts.path ?? specPath));
  if (opts.token) r = r.set('Authorization', `Bearer ${opts.token}`);
  if (opts.cookie) r = r.set('Cookie', opts.cookie);
  if (opts.csrf) r = r.set('X-CSRF-Token', opts.csrf);
  if (opts.headers) r = r.set(opts.headers);
  if (opts.query) r = r.query(opts.query);
  const res = opts.body !== undefined ? await r.send(opts.body as object) : await r;
  expect(
    res.status,
    `${method.toUpperCase()} ${opts.path ?? specPath} -> ${res.status}: ${res.text?.slice(0, 500)}`,
  ).toBe(opts.status);
  return conf.check(method, specPath, res);
}

/** 6-digit code from the n-th (default: last) sent email. */
const sentCode = (n = -1): string => {
  const mail = sendMail.mock.calls.at(n)?.[0] as { text: string } | undefined;
  const m = mail && /\b(\d{6})\b/.exec(mail.text);
  if (!m) throw new Error('no code in email');
  return m[1]!;
};

const refreshCookieOf = (res: Response): string => {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const rt = raw.find((c) => c.startsWith('fx_rt='));
  if (!rt) throw new Error(`no fx_rt cookie in ${JSON.stringify(raw)}`);
  return rt.split(';')[0]!;
};

const en = (s: string) => ({ en: s, ar: `${s} ع` });

// ---- shared session state (the its run in file order)
const CUSTOMER_EMAIL = 'conf-customer@example.com';
const PASSWORD_1 = 'Passw0rdOne!';
const PASSWORD_2 = 'Passw0rdTwo!';
let adminToken = '';
let customer2Id = '';
let customerToken = '';
let customerCookie = '';
let csrfToken = '';
let categoryId = '';
let productId = '';
let productUpdatedAt = '';
let addressId = '';
let cartTotal = 0;
let order1Id = '';
let order2Id = '';
let inviteeId = '';

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  setTransport({ sendMail } as never);
  const hash = await hashPassword(PASSWORD_1);
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'conf-admin@example.com',
      passwordHash: hash,
      isVerified: true,
      role: 'ADMIN',
    },
  });
  adminToken = signAccessToken(admin);
  const c2 = await prisma.user.create({
    data: {
      firstName: 'Customer',
      lastName: 'Two',
      email: 'conf-customer2@example.com',
      passwordHash: hash,
      isVerified: true,
    },
  });
  customer2Id = c2.id;
  await prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: en('Furnixa'),
      contactEmail: 'info@furnixa.example',
      contactPhone: '+966551234567',
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
      deliveryCities: [
        {
          code: 'riyadh',
          name: { en: 'Riyadh', ar: 'الرياض' },
          isActive: true,
          sortOrder: 1,
          deliveryFee: null,
        },
        {
          code: 'jeddah',
          name: { en: 'Jeddah', ar: 'جدة' },
          isActive: true,
          sortOrder: 2,
          deliveryFee: null,
        },
      ],
    },
  });
});

afterAll(async () => {
  setTransport(undefined);
  await prisma.$disconnect();
});

it('NFR-01 · system route conforms (/health)', async () => {
  await call('get', '/health', { status: 200 });
});

it('NFR-01 · auth lifecycle routes conform', async () => {
  await call('post', '/auth/register', {
    status: 201,
    body: { firstName: 'Sara', lastName: 'Ali', email: CUSTOMER_EMAIL, password: PASSWORD_1 },
  });
  const code = sentCode();
  // resend-otp: RESET_PASSWORD for a never-seen email is the documented identical 200 (decoy row).
  await call('post', '/auth/resend-otp', {
    status: 200,
    body: { email: 'conf-unknown@example.com', purpose: 'RESET_PASSWORD' },
  });
  await call('post', '/auth/verify-otp', {
    status: 200,
    body: { email: CUSTOMER_EMAIL, code },
  });
  const login = await call('post', '/auth/login', {
    status: 200,
    body: { email: CUSTOMER_EMAIL, password: PASSWORD_1 },
  });
  customerCookie = refreshCookieOf(login);
  const csrf = await call('get', '/auth/csrf', { status: 200, cookie: customerCookie });
  csrfToken = (csrf.body as { csrfToken: string }).csrfToken;
  const refreshed = await call('post', '/auth/refresh', {
    status: 200,
    cookie: customerCookie,
    csrf: csrfToken,
  });
  customerCookie = refreshCookieOf(refreshed);
  customerToken = (refreshed.body as { accessToken: string }).accessToken;
  await call('get', '/auth/me', { status: 200, token: customerToken });
  await call('post', '/auth/forgot-password', { status: 200, body: { email: CUSTOMER_EMAIL } });
  await call('post', '/auth/reset-password', {
    status: 200,
    body: { email: CUSTOMER_EMAIL, code: sentCode(), newPassword: PASSWORD_2 },
  });
  // The reset revoked every session and old access tokens; log in again with the new password.
  // Tokens issued in the same second as passwordChangedAt are rejected (AUTH-03, 1 s granularity),
  // so step past that second before logging in.
  await new Promise((r) => setTimeout(r, 1100));
  const relogin = await call('post', '/auth/login', {
    status: 200,
    body: { email: CUSTOMER_EMAIL, password: PASSWORD_2 },
  });
  customerCookie = refreshCookieOf(relogin);
  customerToken = (relogin.body as { accessToken: string }).accessToken;
  // Bearer-only logout: nothing to revoke, documented 204; the session above stays usable.
  await call('post', '/auth/logout', { status: 204, token: customerToken });
});

it('NFR-01 · profile and address routes conform', async () => {
  const presign = await call('post', '/me/avatar/presign', {
    status: 200,
    token: customerToken,
    body: { contentType: 'image/png', size: 500 },
  });
  const avatarKey = (presign.body as { key: string }).key;
  s3State.objects.set(avatarKey, { ContentType: 'image/png', ContentLength: 500 });
  await call('patch', '/me', { status: 200, token: customerToken, body: { avatar: avatarKey } });
  const addr = {
    label: 'Home',
    fullName: 'Sara Ali',
    phone: '0551234567',
    cityCode: 'riyadh',
    area: 'Olaya',
    street: 'King Fahd Rd 12',
  };
  const a1 = await call('post', '/me/addresses', { status: 201, token: customerToken, body: addr });
  addressId = (a1.body as { id: string }).id;
  const a2 = await call('post', '/me/addresses', {
    status: 201,
    token: customerToken,
    body: { ...addr, label: 'Work' },
  });
  await call('get', '/me/addresses', { status: 200, token: customerToken });
  await call('patch', '/me/addresses/{id}', {
    status: 200,
    path: `/me/addresses/${addressId}`,
    token: customerToken,
    body: { area: 'Al Malaz' },
  });
  await call('delete', '/me/addresses/{id}', {
    status: 204,
    path: `/me/addresses/${(a2.body as { id: string }).id}`,
    token: customerToken,
  });
});

it('NFR-01 · catalog routes conform (categories + products, admin and public)', async () => {
  const cat = await call('post', '/admin/categories', {
    status: 201,
    token: adminToken,
    body: { name: { en: 'Living room', ar: 'غرفة المعيشة' }, slug: 'living-room' },
  });
  categoryId = (cat.body as { id: string }).id;
  const tmp = await call('post', '/admin/categories', {
    status: 201,
    token: adminToken,
    body: { name: en('Temp'), slug: 'temp-cat' },
  });
  await call('get', '/admin/categories', { status: 200, token: adminToken });
  await call('patch', '/admin/categories/{id}', {
    status: 200,
    path: `/admin/categories/${(tmp.body as { id: string }).id}`,
    token: adminToken,
    body: { name: en('Temp renamed') },
  });
  await call('delete', '/admin/categories/{id}', {
    status: 204,
    path: `/admin/categories/${(tmp.body as { id: string }).id}`,
    token: adminToken,
  });
  const product = {
    title: en('Sofa One'),
    description: en('A fine sofa'),
    slug: 'sofa-one',
    type: 'NEW',
    condition: 'NEW',
    price: 10_000,
    stock: 5,
    categoryId,
    status: 'PUBLISHED',
  };
  const p1 = await call('post', '/admin/products', {
    status: 201,
    token: adminToken,
    body: product,
  });
  productId = (p1.body as { id: string }).id;
  const p2 = await call('post', '/admin/products', {
    status: 201,
    token: adminToken,
    body: { ...product, slug: 'sofa-two', title: en('Sofa Two') },
  });
  await call('get', '/admin/products', { status: 200, token: adminToken });
  const detail = await call('get', '/admin/products/{id}', {
    status: 200,
    path: `/admin/products/${productId}`,
    token: adminToken,
  });
  productUpdatedAt = (detail.body as { updatedAt: string }).updatedAt;
  const patched = await call('patch', '/admin/products/{id}', {
    status: 200,
    path: `/admin/products/${productId}`,
    token: adminToken,
    body: { expectedUpdatedAt: productUpdatedAt, price: 12_000 },
  });
  productUpdatedAt = (patched.body as { updatedAt: string }).updatedAt;
  await call('delete', '/admin/products/{id}', {
    status: 204,
    path: `/admin/products/${(p2.body as { id: string }).id}`,
    token: adminToken,
  });
  await call('get', '/categories', { status: 200 });
  await call('get', '/products', { status: 200, query: { sort: 'newest' } });
  await call('get', '/products/{slug}', { status: 200, path: '/products/sofa-one' });
});

it('NFR-01 · CMS routes conform (banners, sections, pages, settings, home)', async () => {
  const presign = (name: string) =>
    call('post', '/admin/uploads/presign', {
      status: 200,
      token: adminToken,
      body: { fileName: name, contentType: 'image/png', size: 1234 },
    });
  const keyOf = (res: Response) => {
    const key = (res.body as { key: string }).key;
    s3State.objects.set(key, { ContentType: 'image/png', ContentLength: 1234 });
    return key;
  };
  const banner = (key: string, title: string) => ({
    title: en(title),
    imageDesktop: { key, alt: en(`${title} alt`) },
  });
  const b1 = await call('post', '/admin/banners', {
    status: 201,
    token: adminToken,
    body: banner(keyOf(await presign('b1.png')), 'Big sale'),
  });
  const b2 = await call('post', '/admin/banners', {
    status: 201,
    token: adminToken,
    body: banner(keyOf(await presign('b2.png')), 'Second'),
  });
  await call('get', '/admin/banners', { status: 200, token: adminToken });
  await call('patch', '/admin/banners/{id}', {
    status: 200,
    path: `/admin/banners/${(b1.body as { id: string }).id}`,
    token: adminToken,
    body: {
      expectedUpdatedAt: (b1.body as { updatedAt: string }).updatedAt,
      sortOrder: 2,
    },
  });
  // CR-011: a reorder bumps updatedAt, so it runs after the PATCH above (which needed the old token).
  await call('put', '/admin/banners/order', {
    status: 204,
    token: adminToken,
    body: { ids: [(b2.body as { id: string }).id, (b1.body as { id: string }).id] },
  });
  await call('delete', '/admin/banners/{id}', {
    status: 204,
    path: `/admin/banners/${(b2.body as { id: string }).id}`,
    token: adminToken,
  });

  const s1 = await call('post', '/admin/home-sections', {
    status: 201,
    token: adminToken,
    body: { type: 'FEATURED_PRODUCTS', title: en('Featured') },
  });
  const s2 = await call('post', '/admin/home-sections', {
    status: 201,
    token: adminToken,
    body: { type: 'NEW_ARRIVALS', title: en('New arrivals') },
  });
  await call('get', '/admin/home-sections', { status: 200, token: adminToken });
  const s1Id = (s1.body as { id: string }).id;
  const s2Id = (s2.body as { id: string }).id;
  await call('put', '/admin/home-sections/reorder', {
    status: 204,
    token: adminToken,
    body: { ids: [s2Id, s1Id] },
  });
  const s1Fresh = await prisma.homeSection.findUniqueOrThrow({ where: { id: s1Id } });
  await call('patch', '/admin/home-sections/{id}', {
    status: 200,
    path: `/admin/home-sections/${s1Id}`,
    token: adminToken,
    body: { expectedUpdatedAt: s1Fresh.updatedAt.toISOString(), isVisible: true },
  });
  await call('delete', '/admin/home-sections/{id}', {
    status: 204,
    path: `/admin/home-sections/${s2Id}`,
    token: adminToken,
  });

  const page = {
    slug: 'about',
    title: en('About us'),
    content: { en: '<p>About</p>', ar: '<p>حول</p>' },
    isPublished: true,
  };
  const pg1 = await call('post', '/admin/pages', { status: 201, token: adminToken, body: page });
  const pg2 = await call('post', '/admin/pages', {
    status: 201,
    token: adminToken,
    body: { ...page, slug: 'faq', title: en('FAQ') },
  });
  await call('get', '/admin/pages', { status: 200, token: adminToken });
  await call('patch', '/admin/pages/{id}', {
    status: 200,
    path: `/admin/pages/${(pg1.body as { id: string }).id}`,
    token: adminToken,
    body: {
      expectedUpdatedAt: (pg1.body as { updatedAt: string }).updatedAt,
      title: en('About Furnixa'),
    },
  });
  await call('delete', '/admin/pages/{id}', {
    status: 204,
    path: `/admin/pages/${(pg2.body as { id: string }).id}`,
    token: adminToken,
  });
  await call('get', '/cms/pages/{slug}', { status: 200, path: '/cms/pages/about' });
  await call('get', '/cms/home', { status: 200 });
  await call('get', '/cms/settings', { status: 200 });

  const settings = await call('get', '/admin/settings', { status: 200, token: adminToken });
  await call('put', '/admin/settings', {
    status: 200,
    token: adminToken,
    body: {
      expectedUpdatedAt: (settings.body as { updatedAt: string }).updatedAt,
      storeName: en('Furnixa'),
      contactEmail: 'info@furnixa.example',
      contactPhone: '+966551234567',
      deliveryFee: 1500,
      vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true },
      deliveryCities: [
        {
          code: 'riyadh',
          name: { en: 'Riyadh', ar: 'الرياض' },
          isActive: true,
          sortOrder: 1,
          deliveryFee: null,
        },
        {
          code: 'jeddah',
          name: { en: 'Jeddah', ar: 'جدة' },
          isActive: true,
          sortOrder: 2,
          deliveryFee: null,
        },
      ],
      defaultLocale: 'ar',
    },
  });
});

it('NFR-01 · wishlist routes conform', async () => {
  const w = '/me/wishlist';
  await call('put', w + '/{productId}', {
    status: 200,
    path: w + '/' + productId,
    token: customerToken,
  });
  await call('get', w, { status: 200, token: customerToken });
  await call('post', w + '/merge', {
    status: 200,
    token: customerToken,
    body: { productIds: [productId] },
  });
  await call('put', w + '/{productId}', {
    status: 404,
    path: w + '/000000000000000000000000',
    token: customerToken,
  });
  await call('post', w + '/merge', { status: 422, token: customerToken, body: {} });
  await call('delete', w + '/{productId}', {
    status: 200,
    path: w + '/' + productId,
    token: customerToken,
  });
  await call('delete', w, { status: 204, token: customerToken });
  await call('get', w, { status: 403, token: adminToken });
  await call('get', w, { status: 401 });
});

it('NFR-01 · cart, order and dashboard routes conform', async () => {
  await call('put', '/cart/items', {
    status: 200,
    token: customerToken,
    body: { productId, qty: 1 },
  });
  await call('post', '/cart/merge', {
    status: 200,
    token: customerToken,
    body: { items: [{ productId, qty: 1 }] },
  });
  const cart = await call('get', '/cart', {
    status: 200,
    token: customerToken,
    query: { addressId },
  });
  cartTotal = (cart.body as { total: number }).total;
  const key1 = randomUUID();
  const o1 = await call('post', '/orders', {
    status: 201,
    token: customerToken,
    headers: { 'Idempotency-Key': key1 },
    body: { addressId, expectedTotal: cartTotal },
  });
  order1Id = (o1.body as { id: string }).id;
  // Documented 200: an idempotent retry of the same key returns the existing order.
  await call('post', '/orders', {
    status: 200,
    token: customerToken,
    headers: { 'Idempotency-Key': key1 },
    body: { addressId, expectedTotal: cartTotal },
  });
  await call('get', '/orders', { status: 200, token: customerToken });
  await call('get', '/orders/{id}', {
    status: 200,
    path: `/orders/${order1Id}`,
    token: customerToken,
  });
  await call('post', '/orders/{id}/cancel', {
    status: 200,
    path: `/orders/${order1Id}/cancel`,
    token: customerToken,
    body: { reason: 'Changed my mind' },
  });

  await call('put', '/cart/items', {
    status: 200,
    token: customerToken,
    body: { productId, qty: 2 },
  });
  const cart2 = await call('get', '/cart', {
    status: 200,
    token: customerToken,
    query: { addressId },
  });
  const o2 = await call('post', '/orders', {
    status: 201,
    token: customerToken,
    headers: { 'Idempotency-Key': randomUUID() },
    body: { addressId, expectedTotal: (cart2.body as { total: number }).total },
  });
  order2Id = (o2.body as { id: string }).id;
  await call('get', '/admin/orders', { status: 200, token: adminToken });
  await call('get', '/admin/orders/{id}', {
    status: 200,
    path: `/admin/orders/${order2Id}`,
    token: adminToken,
  });
  await call('patch', '/admin/orders/{id}/status', {
    status: 200,
    path: `/admin/orders/${order2Id}/status`,
    token: adminToken,
    body: { status: 'CONFIRMED' },
  });
  await call('patch', '/admin/orders/{id}/note', {
    status: 200,
    path: `/admin/orders/${order2Id}/note`,
    token: adminToken,
    body: { adminNote: 'Call before delivery' },
  });
  await call('get', '/admin/dashboard/summary', { status: 200, token: adminToken });
});

it('NFR-01 · notification routes conform', async () => {
  // The NEW_ORDER row is written by the order.created consumer right after commit; wait for it.
  const list = await vi.waitFor(
    async () => {
      const res = await request(app)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${adminToken}`);
      const body = res.body as { items?: { id: string }[] };
      if (!body.items?.length) throw new Error('no notifications yet');
      return conf.check('get', '/notifications', res);
    },
    { timeout: 10_000, interval: 200 },
  );
  const firstId = (list.body as { items: { id: string }[] }).items[0]!.id;
  await call('patch', '/notifications/{id}/read', {
    status: 204,
    path: `/notifications/${firstId}/read`,
    token: adminToken,
  });
  await call('post', '/notifications/read-all', { status: 204, token: adminToken });
});

it('NFR-01 · admin user routes conform (customers + admins + accept-invite)', async () => {
  await call('get', '/admin/customers', { status: 200, token: adminToken });
  const me = await prisma.user.findUniqueOrThrow({ where: { email: CUSTOMER_EMAIL } });
  await call('get', '/admin/customers/{id}', {
    status: 200,
    path: `/admin/customers/${me.id}`,
    token: adminToken,
  });
  await call('patch', '/admin/customers/{id}/block', {
    status: 200,
    path: `/admin/customers/${customer2Id}/block`,
    token: adminToken,
    body: { isBlocked: true, reason: 'Conformance check' }, // CR-011: a reason is required to block
  });
  // CR-011 (ADM-17): edit name and phone, then soft-delete a throwaway customer.
  const victim = await prisma.user.create({
    data: {
      firstName: 'Conf',
      lastName: 'Victim',
      email: 'conf-victim@example.com',
      passwordHash: 'x',
      isVerified: true,
      phone: null,
      invitedById: null,
    },
  });
  await call('patch', '/admin/customers/{id}', {
    status: 200,
    path: `/admin/customers/${victim.id}`,
    token: adminToken,
    body: {
      expectedUpdatedAt: victim.updatedAt.toISOString(),
      firstName: 'Changed',
      phone: '0551112233',
    },
  });
  await call('delete', '/admin/customers/{id}', {
    status: 200,
    path: `/admin/customers/${victim.id}`,
    token: adminToken,
    body: { confirmEmail: 'conf-victim@example.com' },
  });
  const invite = await call('post', '/admin/admins', {
    status: 201,
    token: adminToken,
    body: { firstName: 'New', lastName: 'Admin', email: 'conf-invitee@example.com' },
  });
  inviteeId = (invite.body as { id: string }).id;
  // The invite OTP starts the 60 s resend cooldown; backdate it so the resend driver is not a 429.
  await prisma.otp.updateMany({
    where: { purpose: 'INVITE_ADMIN' },
    data: { createdAt: new Date(Date.now() - 120_000) },
  });
  await call('post', '/admin/admins/{id}/resend-invite', {
    status: 200,
    path: `/admin/admins/${inviteeId}/resend-invite`,
    token: adminToken,
  });
  await call('post', '/auth/accept-invite', {
    status: 200,
    body: { email: 'conf-invitee@example.com', code: sentCode(), password: PASSWORD_1 },
  });
  await call('get', '/admin/admins', { status: 200, token: adminToken });
  await call('patch', '/admin/admins/{id}/block', {
    status: 200,
    path: `/admin/admins/${inviteeId}/block`,
    token: adminToken,
    body: { isBlocked: true },
  });
});

it('NFR-01 · cron routes conform', async () => {
  const auth = { Authorization: `Bearer ${CRON_SECRET}` };
  await call('get', '/internal/cron/cleanup', { status: 200, headers: auth });
  await call('post', '/internal/cron/cleanup', { status: 200, headers: auth });
  await call('get', '/internal/cron/cleanup', {
    status: 401,
    headers: { Authorization: 'Bearer wrong-secret' },
  });
});

it('NFR-01 · documented error responses carry the Error schema with requestId', async () => {
  await call('get', '/auth/me', { status: 401 });
  await call('post', '/auth/login', {
    status: 401,
    body: { email: CUSTOMER_EMAIL, password: 'WrongPass9' },
  });
  await call('get', '/products/{slug}', { status: 404, path: '/products/no-such-slug' });
  await call('post', '/orders', {
    status: 422,
    token: customerToken,
    body: { addressId, expectedTotal: cartTotal }, // Idempotency-Key header missing
  });
  await call('get', '/admin/categories', { status: 403, token: customerToken });
});

it('NFR-01 · a response status not documented in the spec fails conformance', () => {
  const fake = (status: number, body: unknown = {}) =>
    ({ status, body, text: JSON.stringify(body) }) as unknown as Response;
  expect(() => conf.check('get', '/health', fake(418))).toThrow(ConformanceError);
  expect(() => conf.check('get', '/health', fake(418))).toThrow(/does not document/);
  expect(() => conf.check('get', '/no-such-path', fake(200))).toThrow(/not documented/);
});

it('NFR-01 · a 5xx response fails conformance even where other statuses are documented', () => {
  const fake = { status: 503, body: {}, text: '{}' } as unknown as Response;
  expect(() => conf.check('get', '/health', fake)).toThrow(/503/);
});

it('NFR-01 · a body that does not match the documented schema fails conformance', () => {
  const bad = { status: 200, body: { status: 'down' }, text: '' } as unknown as Response;
  expect(() => conf.check('get', '/health', bad)).toThrow(/does not match/);
  const noRequestId = {
    status: 401,
    body: { code: 'UNAUTHORIZED', message: 'x' },
    text: '{"code":"UNAUTHORIZED","message":"x"}',
  } as unknown as Response;
  expect(() => conf.check('get', '/auth/csrf', noRequestId)).toThrow(/requestId/);
});

it('NFR-01 · every documented operation is exercised and its response conforms to api-spec.yaml', () => {
  expect(conf.uncovered()).toEqual([]);
});

it('NFR-01 · every route in the app is documented in the spec', () => {
  const documented = new Set(
    specOperations(loadSpec()).map((op) => {
      const [method, specPath] = op.split(' ') as [string, string];
      return `${method} ${mountedPath(specPath)}`;
    }),
  );
  const routes = expressRoutes(app).filter((r) => !r.startsWith('HEAD '));
  const undocumented = routes.filter((r) => !documented.has(r));
  expect(undocumented, `routes missing from api-spec.yaml:\n${undocumented.join('\n')}`).toEqual(
    [],
  );
});
