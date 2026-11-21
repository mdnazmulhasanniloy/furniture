import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_me_addr_t007',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const BASE = '/api/v1/me/addresses';

const city = (code: string, isActive: boolean, sortOrder: number) => ({
  code,
  name: { en: code, ar: code },
  isActive,
  sortOrder,
  deliveryFee: null,
});

const addr = (over: Record<string, unknown> = {}) => ({
  label: 'Home',
  fullName: 'Sara Ali',
  phone: '0551234567',
  cityCode: 'riyadh',
  area: 'Olaya',
  street: 'King Fahd Rd 12',
  ...over,
});

let hash = '';
let token = '';
let userId = '';
let otherToken = '';
let otherId = '';

const mkUser = (email: string) =>
  prisma.user.create({
    data: { firstName: 'T', lastName: 'U', email, passwordHash: hash, isVerified: true },
  });
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (body: unknown, t = token) =>
  request(app)
    .post(BASE)
    .set(auth(t))
    .send(body as object);
const patchA = (id: string, body: unknown, t = token) =>
  request(app)
    .patch(`${BASE}/${id}`)
    .set(auth(t))
    .send(body as object);
const del = (id: string, t = token) => request(app).delete(`${BASE}/${id}`).set(auth(t));
const list = async (t = token) =>
  (await request(app).get(BASE).set(auth(t)).expect(200)).body as {
    id: string;
    isDefault: boolean;
    label: string;
  }[];
const defaults = async (uid = userId) =>
  prisma.address.findMany({ where: { userId: uid, isDefault: true } });

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

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne');
});
beforeEach(async () => {
  await prisma.address.deleteMany();
  await prisma.user.deleteMany();
  await seedSettings();
  const u = await mkUser('me@example.com');
  const o = await mkUser('other@example.com');
  [userId, otherId] = [u.id, o.id];
  [token, otherToken] = [signAccessToken(u), signAccessToken(o)];
});
afterAll(async () => {
  await prisma.address.deleteMany();
  await prisma.user.deleteMany();
  await prisma.siteSetting.deleteMany();
  await prisma.$disconnect();
});

describe('PROF-02 · address CRUD', () => {
  it('PROF-02 · create, list, partial update and delete', async () => {
    const c = await post(addr({ notes: 'Ring twice' }));
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({
      label: 'Home',
      phone: '+966551234567',
      cityCode: 'riyadh',
      notes: 'Ring twice',
      isDefault: true,
    });
    expect(c.body).not.toHaveProperty('createdAt');
    expect(c.body).not.toHaveProperty('userId');

    expect(await list()).toHaveLength(1);

    const u = await patchA(c.body.id, { street: 'New street 5', notes: '' });
    expect(u.status).toBe(200);
    expect(u.body).toMatchObject({ street: 'New street 5', label: 'Home', area: 'Olaya' });

    expect((await del(c.body.id)).status).toBe(204);
    expect(await list()).toEqual([]);
    expect((await del(c.body.id)).status).toBe(404);
  });

  it('PROF-02 · requests without a token return 401', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).post(BASE).send(addr())).status).toBe(401);
    expect(
      (
        await request(app)
          .patch(`${BASE}/${'0'.repeat(24)}`)
          .send({ area: 'x' })
      ).status,
    ).toBe(401);
    expect((await request(app).delete(`${BASE}/${'0'.repeat(24)}`)).status).toBe(401);
  });

  it('PROF-02 · unknown fields, missing fields and over-long values give 422', async () => {
    const bad: Record<string, unknown>[] = [
      addr({ userId: otherId }),
      addr({ createdAt: '2020-01-01' }),
      addr({ id: '0'.repeat(24) }),
      { ...addr(), label: undefined },
      addr({ label: 'x'.repeat(31) }),
      addr({ fullName: 'x'.repeat(81) }),
      addr({ area: '' }),
      addr({ street: 'x'.repeat(201) }),
      addr({ notes: 'x'.repeat(301) }),
      addr({ isDefault: 'yes' }),
    ];
    for (const body of bad) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.address.count()).toBe(0);
    // limits are inclusive
    const ok = await post(
      addr({
        label: 'x'.repeat(30),
        fullName: 'x'.repeat(80),
        area: 'x'.repeat(80),
        street: 'x'.repeat(200),
        notes: 'x'.repeat(300),
      }),
    );
    expect(ok.status).toBe(201);
    const a = ok.body.id as string;
    expect((await patchA(a, { userId: otherId })).status).toBe(422);
    expect((await patchA(a, {})).status).toBe(422);
    expect((await patchA(a, { label: 'x'.repeat(31) })).status).toBe(422);
  });

  it('PROF-02 · the 10-address limit: the 11th is 409 ADDRESS_LIMIT_REACHED, deleting one frees a slot', async () => {
    for (let i = 0; i < 10; i++) expect((await post(addr({ label: `A${i}` }))).status).toBe(201);
    const res = await post(addr({ label: 'A10' }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ADDRESS_LIMIT_REACHED');
    expect(await prisma.address.count({ where: { userId } })).toBe(10);
    // another user is not affected
    expect((await post(addr(), otherToken)).status).toBe(201);
    const first = (await list())[0]!;
    // deleting a non-default keeps the default; then one more fits
    const nonDefault = (await list()).find((a) => !a.isDefault)!;
    expect((await del(nonDefault.id)).status).toBe(204);
    expect((await post(addr({ label: 'again' }))).status).toBe(201);
    expect(first.isDefault).toBe(true);
  });

  it('PROF-02 · concurrent creates at the limit never exceed 10', async () => {
    for (let i = 0; i < 8; i++) await post(addr({ label: `A${i}` })).expect(201);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => post(addr({ label: `C${i}` }))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(4);
    expect(await prisma.address.count({ where: { userId } })).toBe(10);
  });
});

describe('PROF-02 · default address', () => {
  it('PROF-02 · the first address is the default even with isDefault false; later ones are not', async () => {
    const a = await post(addr({ label: 'First', isDefault: false }));
    expect(a.body.isDefault).toBe(true);
    const b = await post(addr({ label: 'Second' }));
    expect(b.body.isDefault).toBe(false);
    expect((await defaults()).map((d) => d.label)).toEqual(['First']);
  });

  it('PROF-02 · creating or patching with isDefault true leaves exactly one default', async () => {
    const a = (await post(addr({ label: 'A' }))).body;
    const b = (await post(addr({ label: 'B', isDefault: true }))).body;
    expect(b.isDefault).toBe(true);
    expect((await defaults()).map((d) => d.id)).toEqual([b.id]);
    const patched = await patchA(a.id, { isDefault: true });
    expect(patched.body.isDefault).toBe(true);
    expect((await defaults()).map((d) => d.id)).toEqual([a.id]);
    // the list shows the default first
    expect((await list())[0]!.id).toBe(a.id);
  });

  it('PROF-02 · isDefault false on the current default is 422 VALIDATION_ERROR and keeps it', async () => {
    const a = (await post(addr({ label: 'A' }))).body;
    const res = await patchA(a.id, { isDefault: false });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await defaults()).map((d) => d.id)).toEqual([a.id]);
    // isDefault false on a non-default is a no-op
    const b = (await post(addr({ label: 'B' }))).body;
    expect((await patchA(b.id, { isDefault: false })).status).toBe(200);
    expect((await defaults()).map((d) => d.id)).toEqual([a.id]);
  });

  it('PROF-02 · deleting the default promotes the most recently updated remaining address', async () => {
    const a = (await post(addr({ label: 'A' }))).body;
    const b = (await post(addr({ label: 'B' }))).body;
    const c = (await post(addr({ label: 'C' }))).body;
    await patchA(b.id, { area: 'Touched later' }).expect(200);
    expect((await del(a.id)).status).toBe(204);
    expect((await defaults()).map((d) => d.id)).toEqual([b.id]);
    expect((await del(b.id)).status).toBe(204);
    expect((await defaults()).map((d) => d.id)).toEqual([c.id]);
    // deleting the last address is allowed
    expect((await del(c.id)).status).toBe(204);
    expect(await list()).toEqual([]);
    // deleting a non-default does not change the default
    const d = (await post(addr({ label: 'D' }))).body;
    const e = (await post(addr({ label: 'E' }))).body;
    expect((await del(e.id)).status).toBe(204);
    expect((await defaults()).map((x) => x.id)).toEqual([d.id]);
  });

  it('PROF-02 · concurrent default changes always leave exactly one default', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await post(addr({ label: `A${i}` }))).body.id);
    for (let round = 0; round < 3; round++) {
      const results = await Promise.all(ids.map((id) => patchA(id, { isDefault: true })));
      for (const r of results) expect(r.status).toBe(200);
      expect(await defaults()).toHaveLength(1);
    }
  });

  it('PROF-02 · concurrent first creates produce exactly one default', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post(addr({ label: `N${i}` }))),
    );
    for (const r of results) expect(r.status).toBe(201);
    expect(await prisma.address.count({ where: { userId } })).toBe(5);
    expect(await defaults()).toHaveLength(1);
  });

  it('PROF-02 · concurrent delete of the default and a default change keeps exactly one default', async () => {
    const a = (await post(addr({ label: 'A' }))).body;
    const b = (await post(addr({ label: 'B' }))).body;
    const c = (await post(addr({ label: 'C' }))).body;
    await Promise.all([del(a.id), patchA(c.id, { isDefault: true }), patchA(b.id, { area: 'x' })]);
    expect(await defaults()).toHaveLength(1);
    expect(await prisma.address.count({ where: { userId } })).toBe(2);
  });

  it('PROF-02 · the default of one user is independent of another user', async () => {
    const mine = (await post(addr({ label: 'Mine' }))).body;
    await post(addr({ label: 'Theirs' }), otherToken).expect(201);
    await post(addr({ label: 'Theirs 2', isDefault: true }), otherToken).expect(201);
    expect((await defaults()).map((d) => d.id)).toEqual([mine.id]);
    expect(await defaults(otherId)).toHaveLength(1);
  });
});

describe('PROF-02 · ownership', () => {
  it("PROF-02 · another user's address is 404 on patch and delete, is not listed and stays unchanged", async () => {
    const theirs = (await post(addr({ label: 'Theirs' }), otherToken)).body;
    const p = await patchA(theirs.id, { label: 'Hacked' });
    expect(p.status).toBe(404);
    expect(p.body.code).toBe('NOT_FOUND');
    expect((await patchA(theirs.id, { isDefault: true })).status).toBe(404);
    expect((await del(theirs.id)).status).toBe(404);
    expect(await list()).toEqual([]);
    const db = await prisma.address.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(db).toMatchObject({ label: 'Theirs', userId: otherId });
  });

  it('PROF-02 · a malformed or unknown id is 404, not 500', async () => {
    for (const id of ['abc', '123', 'zzzzzzzzzzzzzzzzzzzzzzzz', '0'.repeat(24)]) {
      expect((await patchA(id, { area: 'x' })).status, id).toBe(404);
      expect((await del(id)).status, id).toBe(404);
    }
  });

  it('PROF-02 · a blocked user token is rejected with 401', async () => {
    await prisma.user.update({ where: { id: userId }, data: { isBlocked: true } });
    expect((await request(app).get(BASE).set(auth(token))).status).toBe(401);
  });
});

describe('PROF-02 · city and phone validation through the routes', () => {
  it('PROF-02 · unknown or inactive cityCode on create -> 422 OUT_OF_DELIVERY_AREA, nothing stored', async () => {
    for (const cityCode of ['atlantis', 'dammam']) {
      const res = await post(addr({ cityCode }));
      expect(res.status, cityCode).toBe(422);
      expect(res.body.code).toBe('OUT_OF_DELIVERY_AREA');
    }
    expect(await prisma.address.count()).toBe(0);
  });

  it('PROF-02 · the city code is stored canonical (trimmed, as configured)', async () => {
    const res = await post(addr({ cityCode: '  RIYADH ' }));
    expect(res.status).toBe(201);
    expect(res.body.cityCode).toBe('riyadh');
  });

  it('PROF-02 · unknown or inactive cityCode on update -> 422; an unchanged city is not re-checked', async () => {
    const a = (await post(addr())).body;
    for (const cityCode of ['atlantis', 'dammam']) {
      const res = await patchA(a.id, { cityCode });
      expect(res.status, cityCode).toBe(422);
      expect(res.body.code).toBe('OUT_OF_DELIVERY_AREA');
    }
    expect((await patchA(a.id, { cityCode: 'jeddah' })).body.cityCode).toBe('jeddah');
    // the admin deactivates the city later: other edits of the address still work
    await seedSettings([city('riyadh', true, 1), city('jeddah', false, 2)]);
    const edit = await patchA(a.id, { street: 'Other street' });
    expect(edit.status).toBe(200);
    expect(edit.body.cityCode).toBe('jeddah');
    expect((await patchA(a.id, { cityCode: 'jeddah' })).status).toBe(422);
    expect((await post(addr({ cityCode: 'jeddah' }))).status).toBe(422);
  });

  it('PROF-02 · an address in a deactivated city returns isDeliverable false and stays editable', async () => {
    const a = await post(addr({ cityCode: 'jeddah' }));
    expect(a.status).toBe(201);
    expect(a.body.isDeliverable).toBe(true);
    expect(a.body.notes).toBeNull();
    const b = (await post(addr({ label: 'B' }))).body;
    expect(b.isDeliverable).toBe(true);

    // the admin deactivates jeddah: read per request, no cache
    await seedSettings([city('riyadh', true, 1), city('jeddah', false, 2)]);
    const rows = (await request(app).get(BASE).set(auth(token)).expect(200)).body as {
      id: string;
      isDeliverable: boolean;
    }[];
    expect(rows.find((r) => r.id === a.body.id)!.isDeliverable).toBe(false);
    expect(rows.find((r) => r.id === b.id)!.isDeliverable).toBe(true);

    const edit = await patchA(a.body.id, { street: 'Still editable 1' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ street: 'Still editable 1', isDeliverable: false });

    // moving it to an active city makes it deliverable again; a city removed from settings is not deliverable
    const moved = await patchA(a.body.id, { cityCode: 'riyadh' });
    expect(moved.body.isDeliverable).toBe(true);
    await seedSettings([city('jeddah', true, 1)]);
    expect(
      (await list()).every((r) => (r as { isDeliverable?: boolean }).isDeliverable === false),
    ).toBe(true);
    expect(Object.keys(edit.body)).not.toContain('createdAt');
  });

  it('PROF-02 · phone is normalised to +9665XXXXXXXX on create and update via the shared validator', async () => {
    for (const phone of [
      '0551234567',
      '551234567',
      '+966 55 123 4567',
      '00966551234567',
      '٠٥٥١٢٣٤٥٦٧',
    ]) {
      const res = await post(addr({ phone }));
      expect(res.status, phone).toBe(201);
      expect(res.body.phone).toBe('+966551234567');
    }
    const a = (await list())[0]!;
    const up = await patchA(a.id, { phone: '050-765-4321' });
    expect(up.body.phone).toBe('+966507654321');
    expect((await prisma.address.findUniqueOrThrow({ where: { id: a.id } })).phone).toBe(
      '+966507654321',
    );
  });

  it('PROF-02 · an invalid phone (landline, letters, too long, not a string) is 422 VALIDATION_ERROR on create and update', async () => {
    const a = (await post(addr())).body;
    for (const phone of ['0112345678', 'abc', '05512', '0'.repeat(26), 551234567, null]) {
      const c = await post(addr({ phone }));
      expect(c.status, String(phone)).toBe(422);
      expect(c.body.code).toBe('VALIDATION_ERROR');
      const u = await patchA(a.id, { phone });
      expect(u.status, String(phone)).toBe(422);
    }
    expect(await prisma.address.count({ where: { userId } })).toBe(1);
    expect((await prisma.address.findUniqueOrThrow({ where: { id: a.id } })).phone).toBe(
      '+966551234567',
    );
  });

  it('PROF-02 · error responses use the Error schema with a requestId', async () => {
    const res = await post(addr({ cityCode: 'atlantis' }));
    expect(res.body).toMatchObject({ code: 'OUT_OF_DELIVERY_AREA' });
    expect(typeof res.body.message).toBe('string');
    expect(typeof res.body.requestId).toBe('string');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });
});
