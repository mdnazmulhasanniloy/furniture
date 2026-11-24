import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_pricing_t021',
  );
});
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
let adminToken = '';

const cities = [
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
];

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'admin@example.com',
      passwordHash: await hashPassword('Passw0rdOne!'),
      isVerified: true,
      role: 'ADMIN',
    },
  });
  adminToken = signAccessToken(admin);
});
afterAll(async () => {
  await prisma.siteSetting.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-14 · delivery fee & VAT settings persistence', () => {
  it('ADM-14 · defaults when absent are 0 / null / {0, true, true}; PUT persists fee, threshold, vat and per-city override', async () => {
    // A row created without fee/threshold/vat values gets the ADR-009 defaults.
    const seeded = await prisma.siteSetting.create({
      data: {
        key: 'default',
        storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
        contactEmail: 'seed@furnixa.test',
        contactPhone: 'seed-phone',
        vat: {},
        deliveryCities: cities,
      },
    });

    const before = await request(app)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    expect(before.body.deliveryFee).toBe(0);
    expect(before.body.freeDeliveryThreshold).toBeNull();
    expect(before.body.vat).toEqual({
      vatRate: 0,
      applyToDelivery: true,
      pricesIncludeVat: true,
      registrationNumber: null,
    });
    expect(
      before.body.deliveryCities.map((c: { deliveryFee: number | null }) => c.deliveryFee),
    ).toEqual([null, null]);

    // PUT persists the ADM-14 values, including a per-city override.
    const put = await request(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        expectedUpdatedAt: seeded.updatedAt.toISOString(),
        storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
        contactEmail: 'info@furnixa.test',
        contactPhone: '0500000000',
        deliveryFee: 1500,
        freeDeliveryThreshold: 10000,
        vat: {
          vatRate: 15,
          applyToDelivery: false,
          pricesIncludeVat: false,
          registrationNumber: '311111111111113',
        },
        deliveryCities: [cities[0], { ...cities[1], deliveryFee: 2000 }],
        defaultLocale: 'ar',
      });
    expect(put.status).toBe(200);

    const after = await request(app)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(after.status).toBe(200);
    expect(after.body.deliveryFee).toBe(1500);
    expect(after.body.freeDeliveryThreshold).toBe(10000);
    expect(after.body.vat).toEqual({
      vatRate: 15,
      applyToDelivery: false,
      pricesIncludeVat: false,
      registrationNumber: '311111111111113',
    });
    expect(
      after.body.deliveryCities.map((c: { code: string; deliveryFee: number | null }) => [
        c.code,
        c.deliveryFee,
      ]),
    ).toEqual([
      ['riyadh', null],
      ['jeddah', 2000],
    ]);
  });
});
