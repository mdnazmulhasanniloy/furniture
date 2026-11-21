import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with tests that wipe shared collections (seed.test.ts).
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cities_t020',
  );
});

import { assertActiveCity } from '../../src/lib/deliveryCities.js';
import { AppError } from '../../src/lib/errors.js';
import { prisma } from '../../src/lib/prisma.js';
import { createErrorHandler } from '../../src/middleware/error.js';
import { requestId } from '../../src/middleware/requestId.js';

const city = (code: string, isActive: boolean, sortOrder: number) => ({
  code,
  name: { en: code, ar: code },
  isActive,
  sortOrder,
  deliveryFee: null,
});

async function seedSettings(
  cities = [city('riyadh', true, 1), city('jeddah', true, 2), city('dammam', false, 3)],
) {
  await prisma.siteSetting.deleteMany();
  await prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'a@example.com',
      contactPhone: '+966551234567',
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
      deliveryCities: cities,
    },
  });
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return undefined;
}

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await seedSettings();
});

describe('PROF-02 · assertActiveCity', () => {
  it('PROF-02 · an active city passes and returns it', async () => {
    const c = await assertActiveCity('riyadh');
    expect(c.code).toBe('riyadh');
    expect(c.isActive).toBe(true);
  });

  it('PROF-02 · an unknown city code -> 422 OUT_OF_DELIVERY_AREA', async () => {
    const e = await failure(assertActiveCity('atlantis'));
    expect(e).toBeInstanceOf(AppError);
    expect(e).toMatchObject({ status: 422, code: 'OUT_OF_DELIVERY_AREA' });
  });

  it('PROF-02 · an inactive city -> 422 OUT_OF_DELIVERY_AREA', async () => {
    const e = await failure(assertActiveCity('dammam'));
    expect(e).toMatchObject({ status: 422, code: 'OUT_OF_DELIVERY_AREA' });
  });

  it('PROF-02 · codes are compared trimmed and lowercased', async () => {
    expect((await assertActiveCity('  Riyadh ')).code).toBe('riyadh');
    expect((await assertActiveCity('JEDDAH')).code).toBe('jeddah');
    expect(await failure(assertActiveCity(' DAMMAM '))).toMatchObject({
      code: 'OUT_OF_DELIVERY_AREA',
    });
  });

  it('PROF-02 · the canonical stored code is returned, not the caller spelling', async () => {
    expect((await assertActiveCity('RIYADH')).code).toBe('riyadh');
  });

  it('PROF-02 · no cache: deactivating a city makes the very next call fail, and reactivating makes it pass', async () => {
    expect((await assertActiveCity('jeddah')).code).toBe('jeddah');
    await seedSettings([city('riyadh', true, 1), city('jeddah', false, 2)]);
    expect(await failure(assertActiveCity('jeddah'))).toMatchObject({
      code: 'OUT_OF_DELIVERY_AREA',
    });
    await seedSettings([city('riyadh', true, 1), city('jeddah', true, 2)]);
    expect((await assertActiveCity('jeddah')).code).toBe('jeddah');
  });

  it('PROF-02 · a city added by the admin is accepted immediately', async () => {
    expect(await failure(assertActiveCity('tabuk'))).toBeDefined();
    await seedSettings([city('riyadh', true, 1), city('tabuk', true, 2)]);
    expect((await assertActiveCity('tabuk')).code).toBe('tabuk');
  });

  it.each([undefined, null, '', '   ', 42, {}, []])(
    'PROF-02 · empty or non-string code %j -> 422',
    async (input) => {
      expect(await failure(assertActiveCity(input))).toMatchObject({
        status: 422,
        code: 'OUT_OF_DELIVERY_AREA',
      });
    },
  );

  it('PROF-02 · a missing SiteSetting row is 422 (no city is active), not a 500', async () => {
    await prisma.siteSetting.deleteMany();
    expect(await failure(assertActiveCity('riyadh'))).toMatchObject({
      status: 422,
      code: 'OUT_OF_DELIVERY_AREA',
    });
  });

  it('PROF-02 · the error goes out as the Error schema (code, message, details, requestId)', async () => {
    const app = express();
    app.use(requestId);
    app.get('/x', async (req, _res, next) => {
      try {
        await assertActiveCity(req.query.c);
      } catch (e) {
        next(e);
      }
    });
    app.use(createErrorHandler(pino({ level: 'silent' })));
    const res = await request(app).get('/x?c=atlantis');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('OUT_OF_DELIVERY_AREA');
    expect(typeof res.body.message).toBe('string');
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'message', 'requestId']);
  });
});
