import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_banners_t011',
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

const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/banners${path}`).set('Authorization', `Bearer ${adminToken}`);
};

const alt = { en: 'Sofa', ar: 'أريكة' };
const upload = { fileName: 'banner.webp', contentType: 'image/webp', size: 102400 };

/** Presign an admin upload and register the "uploaded" object in the mock store. */
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

async function goodBody(overrides: Record<string, unknown> = {}) {
  return {
    title: { en: 'Summer sale', ar: 'تخفيضات الصيف' },
    imageDesktop: { key: await presignedKey(), alt },
    ...overrides,
  };
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne!');
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
  await prisma.banner.deleteMany();
});
afterAll(async () => {
  await prisma.upload.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.banner.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-06 · hero banners', () => {
  it('ADM-06 · admin CRUD roundtrip: create recomputes url, list, patch, delete', async () => {
    const body = await goodBody({ sortOrder: 2 });
    const created = await api('post').send(body);
    expect(created.status).toBe(201);
    expect(created.body.imageDesktop.key).toBe(body.imageDesktop.key);
    expect(created.body.imageDesktop.url).toBe(
      `${getEnv().R2_PUBLIC_BASE_URL}/${body.imageDesktop.key}`,
    );
    expect(created.body.imageDesktop.alt).toEqual(alt);
    expect(created.body.subtitle).toBeNull();
    expect(created.body.isActive).toBe(true);

    const list = await api('get');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const patched = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      title: { en: 'Winter sale', ar: 'تخفيضات الشتاء' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.title.en).toBe('Winter sale');

    await api('delete', `/${created.body.id}`).expect(204);
    expect((await api('get')).body).toHaveLength(0);
  });

  it('ADM-06 · requires an admin: 401 without a token, 403 for a customer', async () => {
    await request(app).get('/api/v1/admin/banners').expect(401);
    await request(app)
      .get('/api/v1/admin/banners')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('ADM-06 · /cms/home shows only active banners inside their schedule, ordered by sortOrder', async () => {
    const now = Date.now();
    const hour = 3_600_000;
    const mk = async (overrides: Record<string, unknown>) =>
      api('post')
        .send(await goodBody(overrides))
        .expect(201);
    await mk({
      title: { en: 'current-window', ar: 'ع' },
      sortOrder: 2,
      startsAt: new Date(now - hour),
      endsAt: new Date(now + hour),
    });
    await mk({ title: { en: 'no-schedule', ar: 'ع' }, sortOrder: 1 });
    await mk({ title: { en: 'future', ar: 'ع' }, startsAt: new Date(now + hour) });
    await mk({ title: { en: 'expired', ar: 'ع' }, endsAt: new Date(now - hour) });
    await mk({ title: { en: 'inactive', ar: 'ع' }, isActive: false });

    const res = await request(app).get('/api/v1/cms/home');
    expect(res.status).toBe(200);
    expect(res.body.banners.map((b: { title: { en: string } }) => b.title.en)).toEqual([
      'no-schedule',
      'current-window',
    ]);
  });

  it('ADM-06 · a banner stored without schedule fields counts as unbounded (null-vs-missing, rule 8)', async () => {
    // Prisma omits unset optional fields, so this document has NO startsAt/endsAt fields at all.
    await prisma.banner.create({
      data: {
        title: { en: 'Legacy', ar: 'قديم' },
        imageDesktop: {
          key: 'furnixa/test/2026/11/legacy.webp',
          url: 'https://cdn.furnixa.test/x',
        },
      },
    });
    const res = await request(app).get('/api/v1/cms/home');
    expect(res.status).toBe(200);
    expect(res.body.banners).toHaveLength(1);
    expect(res.body.banners[0].title.en).toBe('Legacy');
  });

  it('ADM-06 · startsAt must be before endsAt, also on the merged patch result (422)', async () => {
    const now = Date.now();
    const bad = await api('post').send(
      await goodBody({ startsAt: new Date(now + 1000), endsAt: new Date(now) }),
    );
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_ERROR');

    const created = await api('post')
      .send(await goodBody({ endsAt: new Date(now + 1000) }))
      .expect(201);
    // Patch sends only startsAt; merged with the stored endsAt the window is empty.
    const merged = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      startsAt: new Date(now + 2000),
    });
    expect(merged.status).toBe(422);
    expect(merged.body.code).toBe('VALIDATION_ERROR');
  });

  it('ADM-06 · banner images require localized alt text in en and ar (UI-02) -> 422', async () => {
    const key = await presignedKey();
    const noAlt = await api('post').send({
      title: { en: 'X', ar: 'س' },
      imageDesktop: { key },
    });
    expect(noAlt.status).toBe(422);
    expect(noAlt.body.code).toBe('VALIDATION_ERROR');

    const emptyAr = await api('post').send({
      title: { en: 'X', ar: 'س' },
      imageDesktop: { key, alt: { en: 'Sofa', ar: '' } },
    });
    expect(emptyAr.status).toBe(422);
  });

  it('ADM-06 · ctaHref accepts a same-site path or https URL and rejects every unsafe form (422)', async () => {
    const ok1 = await api('post').send(await goodBody({ ctaHref: '/sale' }));
    expect(ok1.status).toBe(201);
    const ok2 = await api('post').send(await goodBody({ ctaHref: 'https://example.com/sale' }));
    expect(ok2.status).toBe(201);

    for (const href of [
      '//evil.example.com',
      '/\\evil.example.com',
      'javascript:alert(1)',
      'data:text/html;base64,PGI+',
      'http://example.com/sale',
    ]) {
      const res = await api('post').send(await goodBody({ ctaHref: href }));
      expect(res.status, href).toBe(422);
      expect(res.body.code, href).toBe('VALIDATION_ERROR');
    }
  });

  it('ADM-06 · a key outside furnixa/{env}/ is rejected with 422 UPLOAD_NOT_ALLOWED', async () => {
    const res = await api('post').send({
      title: { en: 'X', ar: 'س' },
      imageDesktop: {
        key: 'furnixa/production/2026/11/00000000-0000-4000-8000-000000000001.webp',
        alt,
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('UPLOAD_NOT_ALLOWED');
    expect(await prisma.banner.count()).toBe(0);
  });

  it('ADM-06 · replacing imageDesktop releases the old object; imageMobile: null releases the mobile image', async () => {
    const desktop1 = await presignedKey();
    const mobile1 = await presignedKey();
    const created = await api('post')
      .send({
        title: { en: 'X', ar: 'س' },
        imageDesktop: { key: desktop1, alt },
        imageMobile: { key: mobile1, alt },
      })
      .expect(201);

    const desktop2 = await presignedKey();
    const replaced = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      imageDesktop: { key: desktop2, alt },
    });
    expect(replaced.status).toBe(200);
    expect(s3State.deleted).toContain(desktop1);
    expect(await prisma.upload.findUnique({ where: { key: desktop1 } })).toBeNull();

    const removedMobile = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: replaced.body.updatedAt,
      imageMobile: null,
    });
    expect(removedMobile.status).toBe(200);
    expect(removedMobile.body.imageMobile).toBeNull();
    expect(s3State.deleted).toContain(mobile1);
  });

  it('ADM-06 · re-saving with the same keys makes no S3 calls', async () => {
    const created = await api('post')
      .send(await goodBody())
      .expect(201);
    resetS3();
    const res = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      imageDesktop: { key: created.body.imageDesktop.key, alt: { en: 'New alt', ar: 'جديد' } },
      sortOrder: 9,
    });
    expect(res.status).toBe(200);
    expect(res.body.imageDesktop.alt.en).toBe('New alt');
    expect(callsOf('HeadObjectCommand')).toHaveLength(0);
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
  });

  it('ADM-06 · deleting a banner releases both images; a failing DeleteObject is logged, the request succeeds', async () => {
    const desktop = await presignedKey();
    const mobile = await presignedKey();
    const created = await api('post')
      .send({
        title: { en: 'X', ar: 'س' },
        imageDesktop: { key: desktop, alt },
        imageMobile: { key: mobile, alt },
      })
      .expect(201);
    s3State.failDelete.add(mobile);
    await api('delete', `/${created.body.id}`).expect(204);
    expect(s3State.deleted).toContain(desktop);
    expect(await prisma.banner.count()).toBe(0);
    // The failed key's row survives with attachedAt unset so the cleanup cron retries it (T-008).
    const row = await prisma.upload.findUniqueOrThrow({ where: { key: mobile } });
    expect(row.attachedAt).toBeNull();
  });

  it('ADM-06 · release runs only after commit: a stale patch that attaches a new image deletes nothing', async () => {
    const created = await api('post')
      .send(await goodBody())
      .expect(201);
    const oldKey = created.body.imageDesktop.key as string;
    const newKey = await presignedKey();
    const res = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: new Date(0),
      imageDesktop: { key: newKey, alt },
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('STALE_UPDATE');
    expect(callsOf('DeleteObjectCommand')).toHaveLength(0);
    expect(s3State.objects.has(oldKey)).toBe(true);
    expect(
      (await prisma.upload.findUniqueOrThrow({ where: { key: newKey } })).attachedAt,
    ).toBeNull();
    const db = await prisma.banner.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(db.imageDesktop.key).toBe(oldKey);
  });

  it('ADM-06 · two admins editing: the second save gets 409 STALE_UPDATE and the first change survives', async () => {
    const created = await api('post')
      .send(await goodBody())
      .expect(201);
    const loadedByBoth = created.body.updatedAt;

    const first = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: loadedByBoth,
      title: { en: 'First wins', ar: 'الأول' },
    });
    expect(first.status).toBe(200);

    const second = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: loadedByBoth,
      title: { en: 'Second loses', ar: 'الثاني' },
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_UPDATE');
    expect(second.body.details.current.title.en).toBe('First wins');
    const db = await prisma.banner.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(db.title.en).toBe('First wins');
  });

  it('ADM-06 · every admin write calls the revalidation webhook with tag home', async () => {
    const created = await api('post')
      .send(await goodBody())
      .expect(201);
    const patched = await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: created.body.updatedAt, sortOrder: 5 })
      .expect(200);
    await api('delete', `/${created.body.id}`).expect(204);
    expect(patched.status).toBe(200);
    expect(revalidateMock).toHaveBeenCalledTimes(3);
    for (const call of revalidateMock.mock.calls) expect(call[0]).toEqual(['home']);
  });
});

describe('ADM-06 · banner reorder (CR-011)', () => {
  const make = async (title: string) =>
    (
      await api('post')
        .send(await goodBody({ title: { en: title, ar: title } }))
        .expect(201)
    ).body as { id: string };
  const order = async () =>
    ((await api('get')).body as { id: string; sortOrder: number }[]).map(
      (b) => [b.id, b.sortOrder] as const,
    );

  it('ADM-06 · PUT /admin/banners/order sets sortOrder to the list position and the hero follows it', async () => {
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    revalidateMock.mockClear();
    await api('put', '/order')
      .send({ ids: [c.id, a.id, b.id] })
      .expect(204);
    expect(await order()).toEqual([
      [c.id, 1],
      [a.id, 2],
      [b.id, 3],
    ]);
    const home = await request(app).get('/api/v1/cms/home');
    expect(home.body.banners.map((x: { id: string }) => x.id)).toEqual([c.id, a.id, b.id]);
    expect(revalidateMock).toHaveBeenCalledTimes(1);
    expect(revalidateMock.mock.calls[0]![0]).toEqual(['home']);
  });

  it('ADM-06 · a reorder must name every banner exactly once, else 422 and nothing changes (all or nothing)', async () => {
    const [a, b, c] = [await make('A'), await make('B'), await make('C')];
    await api('put', '/order')
      .send({ ids: [c.id, b.id, a.id] })
      .expect(204);
    const before = await order();
    for (const ids of [
      [a.id, b.id],
      [a.id, b.id, c.id, '0'.repeat(24)],
      [a.id, a.id, b.id],
      [],
      ['not-an-id'],
      [a.id, b.id, '0'.repeat(24)],
    ]) {
      const res = await api('put', '/order').send({ ids });
      expect(res.status, JSON.stringify(ids)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await api('put', '/order').send({ ids: [a.id], extra: 1 })).status).toBe(422); // strict body
    expect(await order()).toEqual(before);
  });

  it('ADM-06 · reorder requires an admin: 401 without a token, 403 for a customer, and "order" is never read as an id', async () => {
    const a = await make('A');
    await request(app)
      .put('/api/v1/admin/banners/order')
      .send({ ids: [a.id] })
      .expect(401);
    await request(app)
      .put('/api/v1/admin/banners/order')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ ids: [a.id] })
      .expect(403);
    await api('put', '/order')
      .send({ ids: [a.id] })
      .expect(204); // not 404 NOT_FOUND "Banner not found"
  });
});

describe('ADM-06 · banner focal point (CR-011)', () => {
  it('ADM-06 · focalX and focalY are stored on the photo, returned to the admin and to the public hero', async () => {
    const key = await presignedKey();
    const created = await api('post')
      .send({ title: { en: 'T', ar: 'ع' }, imageDesktop: { key, alt, focalX: 30.5, focalY: 70 } })
      .expect(201);
    expect(created.body.imageDesktop).toMatchObject({ focalX: 30.5, focalY: 70 });
    const home = await request(app).get('/api/v1/cms/home');
    expect(home.body.banners[0].imageDesktop).toMatchObject({ focalX: 30.5, focalY: 70 });
    // mobile has its own point
    const patched = await api('patch', `/${created.body.id}`)
      .send({
        expectedUpdatedAt: created.body.updatedAt,
        imageMobile: { key: await presignedKey(), alt, focalX: 10, focalY: 90 },
      })
      .expect(200);
    expect(patched.body.imageMobile).toMatchObject({ focalX: 10, focalY: 90 });
    expect(patched.body.imageDesktop).toMatchObject({ focalX: 30.5, focalY: 70 }); // untouched
  });

  it('ADM-06 · the focal point is both coordinates or neither, 0 to 100 only, else 422', async () => {
    const key = await presignedKey();
    for (const focal of [
      { focalX: 50 },
      { focalY: 50 },
      { focalX: -1, focalY: 5 },
      { focalX: 5, focalY: 100.5 },
      { focalX: '5', focalY: 5 },
    ]) {
      const res = await api('post').send({
        title: { en: 'T', ar: 'ع' },
        imageDesktop: { key, alt, ...focal },
      });
      expect(res.status, JSON.stringify(focal)).toBe(422);
    }
    expect(await prisma.banner.count()).toBe(0);
  });

  it('ADM-06 · saving the photo again without a focal point clears it (back to the centre)', async () => {
    const key = await presignedKey();
    const created = await api('post')
      .send({ title: { en: 'T', ar: 'ع' }, imageDesktop: { key, alt, focalX: 20, focalY: 20 } })
      .expect(201);
    const cleared = await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: created.body.updatedAt, imageDesktop: { key, alt } })
      .expect(200);
    expect(cleared.body.imageDesktop.focalX ?? null).toBeNull();
    expect(cleared.body.imageDesktop.focalY ?? null).toBeNull();
  });
});
