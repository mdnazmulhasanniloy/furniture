import { execSync } from 'node:child_process';
import nodemailer from 'nodemailer';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_orderemails_t014',
  );
});

import { createApp } from '../../src/app.js';
import { setTransport } from '../../src/emails/mailer.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();

let hash = '';
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
let failSend = false;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Capturing transport: records every mail; rejects when `failSend` is set. */
function captureTransport() {
  const t = nodemailer.createTransport({ jsonTransport: true });
  vi.spyOn(t, 'sendMail').mockImplementation((opts) => {
    if (failSend) return Promise.reject(new Error('smtp down'));
    sent.push(opts as unknown as SentMail);
    return Promise.resolve({} as never);
  });
  return t;
}

const mkUser = (
  email: string,
  preferredLocale: 'en' | 'ar',
  role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER',
) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Ali',
      email,
      passwordHash: hash,
      isVerified: true,
      role,
      preferredLocale,
    },
  });

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
      fullName: 'Sara Ali',
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

/** Places a real order through the API for `user` and returns the created order id. */
async function placeFor(user: { id: string }, customerNote?: string): Promise<string> {
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
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(token))
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      addressId: address.id,
      expectedTotal: 10_000,
      ...(customerNote ? { customerNote } : {}),
    })
    .expect(201);
  return (res.body as { id: string }).id;
}

const patchStatus = (id: string, status: string, note?: string) =>
  request(app)
    .patch(`/api/v1/admin/orders/${id}/status`)
    .set(auth(adminToken))
    .send(note === undefined ? { status } : { status, note });

const waitForMail = (n: number) =>
  vi.waitFor(() => {
    expect(sent).toHaveLength(n);
  });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});

beforeEach(async () => {
  sent = [];
  failSend = false;
  setTransport(captureTransport());
  await Promise.all([
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
  const admin = await mkUser('admin@example.com', 'en', 'ADMIN');
  adminToken = signAccessToken(admin);
  categoryId = (
    await prisma.category.create({
      data: { name: { en: 'Sofas', ar: 'كنب' }, slug: 'sofas', image: null, parentId: null },
    })
  ).id;
});

afterAll(async () => {
  await Promise.all([
    prisma.order.deleteMany(),
    prisma.cart.deleteMany(),
    prisma.address.deleteMany(),
    prisma.product.deleteMany(),
    prisma.rateLimit.deleteMany(),
    prisma.counter.deleteMany(),
  ]);
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSetting.deleteMany();
  setTransport(undefined);
  await prisma.$disconnect();
});

describe('ORD-04 · order emails', () => {
  it('ORD-04 · placing an order sends the order-placed email in the customer preferredLocale (ar)', async () => {
    const user = await mkUser('ar@example.com', 'ar');
    await placeFor(user);
    await waitForMail(1);
    const mail = sent[0]!;
    const order = await prisma.order.findFirstOrThrow({ where: { userId: user.id } });
    expect(mail.to).toBe('ar@example.com');
    expect(mail.subject).toContain(order.orderNo);
    // Arabic template: the subject/body carry Arabic text and the item title's ar value.
    expect(mail.subject).toMatch(/[؀-ۿ]/);
    expect(mail.html).toContain('كنبة');
  });

  it('ORD-04 · placing an order with preferredLocale en sends the English template', async () => {
    const user = await mkUser('en@example.com', 'en');
    await placeFor(user);
    await waitForMail(1);
    expect(sent[0]!.to).toBe('en@example.com');
    expect(sent[0]!.subject).not.toMatch(/[؀-ۿ]/);
    expect(sent[0]!.text).toContain('Sara');
  });

  it('ORD-04 · each status change sends the order-status email in the customer locale', async () => {
    const user = await mkUser('steps@example.com', 'en');
    const orderId = await placeFor(user);
    await waitForMail(1); // the order-placed mail
    let n = 1;
    for (const status of ['CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await patchStatus(orderId, status).expect(200);
      await waitForMail(++n); // the email is async; keep the order of `sent` deterministic
    }
    const statusMails = sent.slice(1);
    expect(statusMails.every((m) => m.to === 'steps@example.com')).toBe(true);
    expect(statusMails.map((m) => m.subject)).toEqual([
      expect.stringContaining('Confirmed'),
      expect.stringContaining('Processing'),
      expect.stringContaining('Out for delivery'),
      expect.stringContaining('Delivered'),
    ]);
  });

  it('ORD-04 · a cancellation emails the customer (ar) without the internal note', async () => {
    const user = await mkUser('cancel@example.com', 'ar');
    const orderId = await placeFor(user);
    await waitForMail(1);
    await patchStatus(orderId, 'CANCELLED', 'SECRET-internal-cancel-reason').expect(200);
    await waitForMail(2);
    const mail = sent[1]!;
    expect(mail.subject).toMatch(/[؀-ۿ]/); // Arabic template
    for (const field of [mail.subject, mail.html, mail.text]) {
      expect(field).not.toContain('SECRET-internal-cancel-reason');
    }
  });

  it('ORD-04 · emails never contain the admin note or the raw customer note', async () => {
    const user = await mkUser('privacy@example.com', 'en');
    const orderId = await placeFor(user, '<b>gate code 1234 & ring</b>');
    await waitForMail(1);
    await request(app)
      .patch(`/api/v1/admin/orders/${orderId}/note`)
      .set(auth(adminToken))
      .send({ adminNote: 'SECRET-admin-only-note' })
      .expect(200);
    await patchStatus(orderId, 'CONFIRMED').expect(200);
    await waitForMail(2);
    for (const mail of sent) {
      for (const field of [mail.subject, mail.html, mail.text]) {
        expect(field).not.toContain('SECRET-admin-only-note');
        // The raw (unescaped) customerNote never appears in any email.
        expect(field).not.toContain('<b>gate code 1234 & ring</b>');
      }
    }
  });

  it('ORD-04 · a failing transport never fails the request: the transition still commits (200)', async () => {
    const user = await mkUser('fail@example.com', 'en');
    const orderId = await placeFor(user); // the placed-mail may also fail silently below
    failSend = true;
    const res = await patchStatus(orderId, 'CONFIRMED');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CONFIRMED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'CONFIRMED',
    );
  });
});
