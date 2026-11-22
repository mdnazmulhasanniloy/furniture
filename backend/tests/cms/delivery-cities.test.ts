import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cities_t022',
  );
});
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';
let customerId = '';
let categoryId = '';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const adminGet = () => request(app).get('/api/v1/admin/settings').set(auth(adminToken));
const adminPut = () => request(app).put('/api/v1/admin/settings').set(auth(adminToken));
const publicGet = () => request(app).get('/api/v1/cms/settings');

type City = {
  code: string;
  name: { en: string; ar: string };
  isActive: boolean;
  sortOrder: number;
  deliveryFee: number | null;
};
const city = (code: string, over: Partial<City> = {}): City => ({
  code,
  name: { en: `${code}-en`, ar: `${code}-ar` },
  isActive: true,
  sortOrder: 1,
  deliveryFee: null,
  ...over,
});

const seededCities = [
  city('riyadh', { sortOrder: 1 }),
  city('jeddah', { sortOrder: 2, deliveryFee: 2000 }),
];

const putBody = (expectedUpdatedAt: string | Date, overrides: Record<string, unknown> = {}) => ({
  expectedUpdatedAt,
  storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
  contactEmail: 'info@furnixa.test',
  contactPhone: '0500000000',
  deliveryFee: 0,
  freeDeliveryThreshold: null,
  vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
  deliveryCities: seededCities,
  defaultLocale: 'ar',
  ...overrides,
});

async function seedSettings() {
  return prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'seed@furnixa.test',
      contactPhone: '0500000000',
      logo: null,
      address: null,
      deliveryFee: 0,
      freeDeliveryThreshold: null,
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      deliveryCities: seededCities,
    },
  });
}

/** PUT that changes only `deliveryCities` and must succeed. Returns the saved body. */
async function putCities(cities: City[]) {
  const loaded = await adminGet().expect(200);
  const res = await adminPut().send(putBody(loaded.body.updatedAt, { deliveryCities: cities }));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { deliveryCities: City[]; updatedAt: string };
}

const dbCities = async () =>
  (await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } })).deliveryCities;

const mkAddress = (cityCode: string) =>
  prisma.address.create({
    data: {
      userId: customerId,
      label: 'Home',
      fullName: 'Sara Ali',
      phone: '+966551234567',
      cityCode,
      area: 'Olaya',
      street: 'King Fahd Rd 12',
      notes: null,
      isDefault: true,
    },
  });

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
  customerId = customer.id;
  const cat = await prisma.category.create({
    data: {
      name: { en: 'Sofas', ar: 'كنب' },
      slug: 'sofas',
      parentId: null,
      image: null,
      sortOrder: 1,
      isActive: true,
    },
  });
  categoryId = cat.id;
});
beforeEach(async () => {
  revalidateMock.mockClear();
  await prisma.order.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.product.deleteMany();
  await prisma.address.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.counter.deleteMany();
  await prisma.siteSetting.deleteMany();
});
afterAll(async () => {
  await prisma.order.deleteMany();
  await prisma.cart.deleteMany();
  await prisma.product.deleteMany();
  await prisma.address.deleteMany();
  await prisma.category.deleteMany();
  await prisma.siteSetting.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-13 · delivery cities admin rules (T-022)', () => {
  it('ADM-13 · adding a city with both names persists and sorts into place', async () => {
    await seedSettings();
    const saved = await putCities([...seededCities, city('mecca', { sortOrder: 0 })]);
    expect(saved.deliveryCities.map((c) => c.code)).toEqual(['mecca', 'riyadh', 'jeddah']);

    const pub = await publicGet().expect(200);
    expect(pub.body.deliveryCities.map((c: City) => c.code)).toEqual(['mecca', 'riyadh', 'jeddah']);
  });

  it('ADM-13 · missing name locale, bad code pattern or duplicate code -> 422, nothing changed', async () => {
    const seeded = await seedSettings();
    const cases: City[][] = [
      [...seededCities, { ...city('mecca'), name: { en: 'Mecca', ar: '' } }],
      [...seededCities, city('Mecca')], // uppercase
      [...seededCities, city('mec ca')], // space
      [...seededCities, city('riyadh', { sortOrder: 9 })], // duplicate
    ];
    for (const deliveryCities of cases) {
      const res = await adminPut().send(putBody(seeded.updatedAt, { deliveryCities }));
      expect(res.status, JSON.stringify(deliveryCities)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await dbCities()).map((c) => c.code)).toEqual(['riyadh', 'jeddah']);
  });

  it('ADM-13 · rename: the name changes, the code does not', async () => {
    await seedSettings();
    const renamed = { ...seededCities[0]!, name: { en: 'Ar-Riyadh', ar: 'مدينة الرياض' } };
    const saved = await putCities([renamed, seededCities[1]!]);
    const riyadh = saved.deliveryCities.find((c) => c.code === 'riyadh');
    expect(riyadh?.name).toEqual({ en: 'Ar-Riyadh', ar: 'مدينة الرياض' });
  });

  it('ADM-13 · reorder: sortOrder drives both admin and public ordering', async () => {
    await seedSettings();
    const saved = await putCities([
      { ...seededCities[0]!, sortOrder: 2 },
      { ...seededCities[1]!, sortOrder: 1, isActive: true },
    ]);
    expect(saved.deliveryCities.map((c) => c.code)).toEqual(['jeddah', 'riyadh']);
    const pub = await publicGet().expect(200);
    expect(pub.body.deliveryCities.map((c: City) => c.code)).toEqual(['jeddah', 'riyadh']);
  });

  it('ADM-13 · toggle active: a deactivated city disappears from /cms/settings but stays in the admin list; reactivation restores it', async () => {
    await seedSettings();
    await putCities([seededCities[0]!, { ...seededCities[1]!, isActive: false }]);

    let pub = await publicGet().expect(200);
    expect(pub.body.deliveryCities.map((c: City) => c.code)).toEqual(['riyadh']);
    const admin = await adminGet().expect(200);
    expect(admin.body.deliveryCities.map((c: City) => c.code)).toEqual(['riyadh', 'jeddah']);

    await putCities(seededCities);
    pub = await publicGet().expect(200);
    expect(pub.body.deliveryCities.map((c: City) => c.code)).toEqual(['riyadh', 'jeddah']);
  });

  it('ADM-13 · removing an existing code -> 409 CITY_CODE_IMMUTABLE with missingCodes, nothing changed', async () => {
    const seeded = await seedSettings();
    const res = await adminPut().send(
      putBody(seeded.updatedAt, { deliveryCities: [seededCities[0]!] }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CITY_CODE_IMMUTABLE');
    expect(res.body.details.missingCodes).toEqual(['jeddah']);
    expect((await dbCities()).map((c) => c.code)).toEqual(['riyadh', 'jeddah']);
  });

  it('ADM-13 · changing a code -> 409 CITY_CODE_IMMUTABLE (the old code is missing)', async () => {
    const seeded = await seedSettings();
    const res = await adminPut().send(
      putBody(seeded.updatedAt, {
        deliveryCities: [seededCities[0]!, { ...seededCities[1]!, code: 'jiddah' }],
      }),
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CITY_CODE_IMMUTABLE');
    expect(res.body.details.missingCodes).toEqual(['jeddah']);
    expect((await dbCities()).map((c) => c.code)).toEqual(['riyadh', 'jeddah']);
  });

  it('ADM-13 · deactivating the last active city -> 422, nothing changed', async () => {
    const seeded = await seedSettings();
    const res = await adminPut().send(
      putBody(seeded.updatedAt, {
        deliveryCities: seededCities.map((c) => ({ ...c, isActive: false })),
      }),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await dbCities()).some((c) => c.isActive)).toBe(true);
  });

  it('ADM-13 · at most 100 cities: 100 saves, 101 -> 422', async () => {
    const seeded = await seedSettings();
    const many = (n: number) => [
      ...seededCities,
      ...Array.from({ length: n - seededCities.length }, (_, i) =>
        city(`city-${i}`, { sortOrder: i + 10 }),
      ),
    ];
    const tooMany = await adminPut().send(putBody(seeded.updatedAt, { deliveryCities: many(101) }));
    expect(tooMany.status).toBe(422);
    expect(tooMany.body.code).toBe('VALIDATION_ERROR');
    expect(await dbCities()).toHaveLength(2);

    const exactly = await adminPut().send(putBody(seeded.updatedAt, { deliveryCities: many(100) }));
    expect(exactly.status).toBe(200);
    expect(exactly.body.deliveryCities).toHaveLength(100);
  });

  it('ADM-13 · per-city deliveryFee: null, 0 and positive save; negative or non-integer -> 422', async () => {
    const seeded = await seedSettings();
    const ok = await putCities([
      { ...seededCities[0]!, deliveryFee: 0 },
      { ...seededCities[1]!, deliveryFee: 3500 },
    ]);
    expect(ok.deliveryCities.map((c) => c.deliveryFee)).toEqual([0, 3500]);
    const okNull = await putCities([{ ...seededCities[0]!, deliveryFee: null }, seededCities[1]!]);
    expect(okNull.deliveryCities[0]?.deliveryFee).toBeNull();

    for (const bad of [-1, 10.5]) {
      const res = await adminPut().send(
        putBody(seeded.updatedAt, {
          deliveryCities: [{ ...seededCities[0]!, deliveryFee: bad }, seededCities[1]!],
        }),
      );
      expect(res.status, String(bad)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('ADM-13 · address create rejects an inactive city; checkout rejects an address whose city was deactivated later', async () => {
    await seedSettings();
    await putCities([seededCities[0]!, { ...seededCities[1]!, isActive: false }]);

    // Address create with the now-inactive city -> 422.
    const created = await request(app).post('/api/v1/me/addresses').set(auth(customerToken)).send({
      label: 'Home',
      fullName: 'Sara Ali',
      phone: '0551234567',
      cityCode: 'jeddah',
      area: 'Olaya',
      street: 'King Fahd Rd 12',
    });
    expect(created.status).toBe(422);
    expect(created.body.code).toBe('OUT_OF_DELIVERY_AREA');

    // Checkout to an address saved while the city was still active -> 422, stock untouched.
    const product = await prisma.product.create({
      data: {
        title: { en: 'Sofa', ar: 'كنبة' },
        description: { en: 'd', ar: 'د' },
        slug: 'sofa-1',
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
    const address = await mkAddress('jeddah'); // written directly: the city was active at save time
    await prisma.cart.create({
      data: {
        userId: customerId,
        items: [{ productId: product.id, qty: 1, priceSeen: 10_000 }],
        version: 0,
      },
    });
    const placed = await request(app)
      .post('/api/v1/orders')
      .set(auth(customerToken))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ addressId: address.id, expectedTotal: 10_000 });
    expect(placed.status).toBe(422);
    expect(placed.body.code).toBe('OUT_OF_DELIVERY_AREA');
    const fresh = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(fresh.stock).toBe(10);
    expect(await prisma.order.count()).toBe(0);
  });

  it('ADM-13 · renaming and deactivating a city leaves existing orders unchanged', async () => {
    await seedSettings();
    const product = await prisma.product.create({
      data: {
        title: { en: 'Sofa', ar: 'كنبة' },
        description: { en: 'd', ar: 'د' },
        slug: 'sofa-2',
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
    const address = await mkAddress('riyadh');
    await prisma.cart.create({
      data: {
        userId: customerId,
        items: [{ productId: product.id, qty: 1, priceSeen: 10_000 }],
        version: 0,
      },
    });
    const placed = await request(app)
      .post('/api/v1/orders')
      .set(auth(customerToken))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ addressId: address.id, expectedTotal: 10_000 });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);

    await putCities([
      { ...seededCities[0]!, name: { en: 'Renamed', ar: 'معاد تسميتها' }, isActive: false },
      seededCities[1]!,
    ]);

    const order = await prisma.order.findFirstOrThrow({ where: { userId: customerId } });
    expect(order.address.cityCode).toBe('riyadh');
    expect(order.address.city).toEqual({ en: 'riyadh-en', ar: 'riyadh-ar' });
  });

  it('ADM-13 · a cities-only change revalidates settings, home and products', async () => {
    await seedSettings();
    revalidateMock.mockClear();
    await putCities([...seededCities, city('mecca', { sortOrder: 3 })]);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock.mock.calls[0]?.[0]).toEqual(['settings', 'home', 'products']);
  });

  it('ADM-13 · a stale expectedUpdatedAt on a cities-only change -> 409 STALE_UPDATE, nothing changed', async () => {
    const seeded = await seedSettings();
    const loadedByBoth = seeded.updatedAt;
    await adminPut()
      .send(putBody(loadedByBoth, { deliveryCities: [...seededCities, city('mecca')] }))
      .expect(200);

    const second = await adminPut().send(
      putBody(loadedByBoth, { deliveryCities: [...seededCities, city('medina')] }),
    );
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_UPDATE');
    expect((await dbCities()).map((c) => c.code)).toEqual(['riyadh', 'jeddah', 'mecca']);
  });
});
