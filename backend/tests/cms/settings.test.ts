import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_settings_t011',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../helpers/s3Mock.js')).presignerModule,
);
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { callsOf, resetS3, s3State } from '../helpers/s3Mock.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';

const get = () =>
  request(app).get('/api/v1/admin/settings').set('Authorization', `Bearer ${adminToken}`);
const put = () =>
  request(app).put('/api/v1/admin/settings').set('Authorization', `Bearer ${adminToken}`);

const upload = { fileName: 'logo.webp', contentType: 'image/webp', size: 51200 };
async function presignedKey(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/admin/uploads/presign')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(upload);
  expect(res.status).toBe(200);
  const key = res.body.key as string;
  s3State.objects.set(key, { ContentType: upload.contentType, ContentLength: upload.size });
  return key;
}

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
    isActive: false,
    sortOrder: 2,
    deliveryFee: 2000,
  },
];

const putBody = (expectedUpdatedAt: string | Date, overrides: Record<string, unknown> = {}) => ({
  expectedUpdatedAt,
  storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
  contactEmail: 'info@furnixa.test',
  contactPhone: '0500000000',
  deliveryFee: 1500,
  freeDeliveryThreshold: null,
  vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
  deliveryCities: cities,
  defaultLocale: 'ar',
  ...overrides,
});

async function seedSettings() {
  return prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'seed@furnixa.test',
      contactPhone: 'seed-phone',
      logo: null,
      address: null,
      freeDeliveryThreshold: null,
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      deliveryCities: cities,
    },
  });
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne');
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'admin@example.com',
      passwordHash: hash,
      isVerified: true,
      role: 'ADMIN',
    },
  });
  const customer = await prisma.user.create({
    data: {
      firstName: 'Cust',
      lastName: 'One',
      email: 'cust@example.com',
      passwordHash: hash,
      isVerified: true,
    },
  });
  adminToken = signAccessToken(admin);
  customerToken = signAccessToken(customer);
});
beforeEach(async () => {
  resetS3();
  revalidateMock.mockClear();
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.siteSetting.deleteMany();
});
afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.siteSetting.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-09 · site settings', () => {
  it('ADM-09 · GET/PUT round-trip; currency is fixed and not accepted; admin only', async () => {
    await request(app).get('/api/v1/admin/settings').expect(401);
    await request(app)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    await seedSettings();
    const loaded = await get().expect(200);
    expect(loaded.body.currency).toBe('SAR');

    const saved = await put().send(putBody(loaded.body.updatedAt));
    expect(saved.status).toBe(200);
    expect(saved.body.deliveryFee).toBe(1500);
    expect(saved.body.vat.vatRate).toBe(15);
    expect(saved.body.currency).toBe('SAR');
    // Full replace: optional fields not sent are cleared.
    expect(saved.body.address).toBeNull();

    const currency = await put().send(putBody(saved.body.updatedAt, { currency: 'USD' }));
    expect(currency.status).toBe(422);
    expect(currency.body.code).toBe('VALIDATION_ERROR');
  });

  it('ADM-09 · /cms/settings is public and returns active cities only', async () => {
    await seedSettings();
    const res = await request(app).get('/api/v1/cms/settings');
    expect(res.status).toBe(200);
    expect(res.body.deliveryCities.map((c: { code: string }) => c.code)).toEqual(['riyadh']);
    expect(res.body.currency).toBe('SAR');

    const admin = await get().expect(200);
    expect(admin.body.deliveryCities.map((c: { code: string }) => c.code)).toEqual([
      'riyadh',
      'jeddah',
    ]);
  });

  it('ADM-09 · negative fees, a VAT rate outside 0-50 or with >2 decimals, and a bad registration number -> 422', async () => {
    const seeded = await seedSettings();
    const cases: Record<string, unknown>[] = [
      { deliveryFee: -1 },
      { freeDeliveryThreshold: -5 },
      { vat: { vatRate: 50.01, applyToDelivery: true, pricesIncludeVat: true } },
      { vat: { vatRate: 15.123, applyToDelivery: true, pricesIncludeVat: true } },
      { vat: { vatRate: -1, applyToDelivery: true, pricesIncludeVat: true } },
      {
        vat: {
          vatRate: 15,
          applyToDelivery: true,
          pricesIncludeVat: true,
          registrationNumber: '123456789012345', // must start and end with 3
        },
      },
    ];
    for (const overrides of cases) {
      const res = await put().send(putBody(seeded.updatedAt, overrides));
      expect(res.status, JSON.stringify(overrides)).toBe(422);
      expect(res.body.code, JSON.stringify(overrides)).toBe('VALIDATION_ERROR');
    }
    // A valid registration number passes.
    const ok = await put().send(
      putBody(seeded.updatedAt, {
        vat: {
          vatRate: 15,
          applyToDelivery: false,
          pricesIncludeVat: false,
          registrationNumber: '310000000000003',
        },
      }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body.vat.registrationNumber).toBe('310000000000003');
  });

  it('ADM-09 · duplicate city codes or a missing city name locale -> 422', async () => {
    const seeded = await seedSettings();
    const dup = await put().send(
      putBody(seeded.updatedAt, { deliveryCities: [cities[0], { ...cities[1], code: 'riyadh' }] }),
    );
    expect(dup.status).toBe(422);
    const noAr = await put().send(
      putBody(seeded.updatedAt, {
        deliveryCities: [{ ...cities[0], name: { en: 'Riyadh', ar: '' } }],
      }),
    );
    expect(noAr.status).toBe(422);
    const empty = await put().send(putBody(seeded.updatedAt, { deliveryCities: [] }));
    expect(empty.status).toBe(422);
  });

  it('ADM-09 · logo: url recomputed; foreign key 422; replace releases the old object; null clears it', async () => {
    const seeded = await seedSettings();

    const foreign = await put().send(
      putBody(seeded.updatedAt, {
        logo: { key: 'furnixa/production/2026/11/00000000-0000-4000-8000-000000000001.webp' },
      }),
    );
    expect(foreign.status).toBe(422);
    expect(foreign.body.code).toBe('UPLOAD_NOT_ALLOWED');

    const key1 = await presignedKey();
    const set = await put().send(putBody(seeded.updatedAt, { logo: { key: key1 } }));
    expect(set.status).toBe(200);
    expect(set.body.logo.url).toBe(`${getEnv().R2_PUBLIC_BASE_URL}/${key1}`);

    // Re-save with the same key: no S3 calls.
    resetS3();
    const resave = await put().send(putBody(set.body.updatedAt, { logo: { key: key1 } }));
    expect(resave.status).toBe(200);
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);

    const key2 = await presignedKey();
    const replaced = await put().send(putBody(resave.body.updatedAt, { logo: { key: key2 } }));
    expect(replaced.status).toBe(200);
    expect(s3State.deleted).toContain(key1);
    expect(await prisma.upload.findUnique({ where: { key: key1 } })).toBeNull();

    const cleared = await put().send(putBody(replaced.body.updatedAt, { logo: null }));
    expect(cleared.status).toBe(200);
    expect(cleared.body.logo).toBeNull();
    expect(s3State.deleted).toContain(key2);
  });

  it('ADM-09 · two admins editing settings: the second save gets 409 and the first change survives', async () => {
    const seeded = await seedSettings();
    const loadedByBoth = seeded.updatedAt;

    const first = await put().send(putBody(loadedByBoth, { deliveryFee: 1000 }));
    expect(first.status).toBe(200);

    const second = await put().send(putBody(loadedByBoth, { deliveryFee: 9999 }));
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_UPDATE');
    expect(second.body.details.current.deliveryFee).toBe(1000);

    const db = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(db.deliveryFee).toBe(1000);
  });

  it('ADM-09 · a settings write revalidates settings, home and products', async () => {
    const seeded = await seedSettings();
    await put().send(putBody(seeded.updatedAt)).expect(200);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock.mock.calls[0]?.[0]).toEqual(['settings', 'home', 'products']);
  });
});
