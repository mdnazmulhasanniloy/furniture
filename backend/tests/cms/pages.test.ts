import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_pages_t011',
  );
});
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';

const api = (method: 'get' | 'post' | 'patch' | 'delete', path = '') => {
  const agent = request(app);
  return agent[method](`/api/v1/admin/pages${path}`).set('Authorization', `Bearer ${adminToken}`);
};

const goodBody = (overrides: Record<string, unknown> = {}) => ({
  slug: 'about',
  title: { en: 'About us', ar: 'من نحن' },
  content: { en: '<p>Hello</p>', ar: '<p>مرحبا</p>' },
  ...overrides,
});

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
  revalidateMock.mockClear();
  await prisma.page.deleteMany();
  await prisma.rateLimit.deleteMany();
});
afterAll(async () => {
  await prisma.page.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-08 · static pages', () => {
  it('ADM-08 · admin CRUD roundtrip; 401 without a token, 403 for a customer', async () => {
    await request(app).get('/api/v1/admin/pages').expect(401);
    await request(app)
      .get('/api/v1/admin/pages')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);

    const created = await api('post').send(goodBody());
    expect(created.status).toBe(201);
    expect(created.body.isPublished).toBe(false);
    expect(created.body.metaTitle).toBeNull();

    const patched = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      metaDescription: { en: 'About Furnixa', ar: 'عن فرنيكسا' },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.metaDescription.en).toBe('About Furnixa');

    expect((await api('get')).body).toHaveLength(1);
    await api('delete', `/${created.body.id}`).expect(204);
    expect((await api('get')).body).toHaveLength(0);
  });

  it('ADM-08 · a duplicate slug -> 409 SLUG_TAKEN, on create and on rename', async () => {
    await api('post').send(goodBody()).expect(201);
    const dup = await api('post').send(goodBody({ title: { en: 'Other', ar: 'آخر' } }));
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('SLUG_TAKEN');

    const other = await api('post')
      .send(goodBody({ slug: 'faq' }))
      .expect(201);
    const renamed = await api('patch', `/${other.body.id}`).send({
      expectedUpdatedAt: other.body.updatedAt,
      slug: 'about',
    });
    expect(renamed.status).toBe(409);
    expect(renamed.body.code).toBe('SLUG_TAKEN');
  });

  it('ADM-08 · /cms/pages/{slug} returns a published page; unpublished or unknown -> 404', async () => {
    const created = await api('post').send(goodBody()).expect(201);
    await request(app).get('/api/v1/cms/pages/about').expect(404);
    await request(app).get('/api/v1/cms/pages/unknown').expect(404);

    await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: created.body.updatedAt, isPublished: true })
      .expect(200);
    const res = await request(app).get('/api/v1/cms/pages/about');
    expect(res.status).toBe(200);
    expect(res.body.title.en).toBe('About us');
  });

  it('ADM-08 · script, onerror and javascript: links are stripped on save', async () => {
    const created = await api('post').send(
      goodBody({
        content: {
          en:
            '<p>Safe</p><script>alert(1)</script>' +
            `<img src="${getEnv().R2_PUBLIC_BASE_URL}/furnixa/test/2026/11/a.webp" onerror="alert(2)">` +
            '<a href="javascript:alert(3)">click</a><iframe src="https://evil.example.com"></iframe>' +
            '<p style="background:url(javascript:x)" onclick="alert(4)">styled</p>',
          ar: '<p>مرحبا</p>',
        },
      }),
    );
    expect(created.status).toBe(201);
    const stored = (await prisma.page.findUniqueOrThrow({ where: { slug: 'about' } })).content.en;
    for (const text of [created.body.content.en as string, stored]) {
      expect(text).toContain('<p>Safe</p>');
      expect(text).toContain('<p>styled</p>');
      expect(text).toContain('click'); // link text survives, the javascript: href does not
      expect(text).not.toContain('script');
      expect(text).not.toContain('onerror');
      expect(text).not.toContain('onclick');
      expect(text).not.toContain('style=');
      expect(text).not.toContain('javascript:');
      expect(text).not.toContain('iframe');
      expect(text).not.toContain('alert');
    }
  });

  it('ADM-08 · allowed formatting survives; external links get rel="noopener noreferrer"', async () => {
    const en =
      '<h2>Title</h2><p><strong>Bold</strong> <em>italic</em> <u>u</u> <s>s</s></p>' +
      '<ul><li>One</li></ul><ol><li>Two</li></ol><blockquote>Quote</blockquote><hr>' +
      '<a href="https://example.com/x">external</a><a href="/contact">internal</a>';
    const created = await api('post').send(goodBody({ content: { en, ar: '<p>م</p>' } }));
    expect(created.status).toBe(201);
    const text = created.body.content.en as string;
    for (const bit of [
      '<h2>Title</h2>',
      '<strong>Bold</strong>',
      '<em>italic</em>',
      '<u>u</u>',
      '<s>s</s>',
      '<ul><li>One</li></ul>',
      '<ol><li>Two</li></ol>',
      '<blockquote>Quote</blockquote>',
      '<hr',
      '<a href="/contact">internal</a>',
    ]) {
      expect(text).toContain(bit);
    }
    expect(text).toMatch(
      /<a href="https:\/\/example\.com\/x" rel="noopener noreferrer">external<\/a>/,
    );
  });

  it('ADM-08 · an img with a foreign src is removed; an R2 img survives', async () => {
    const r2Src = `${getEnv().R2_PUBLIC_BASE_URL}/furnixa/test/2026/11/pic.webp`;
    const created = await api('post').send(
      goodBody({
        content: {
          en: `<p>x</p><img src="${r2Src}" alt="ok"><img src="https://evil.example.com/pic.webp"><img src="/local.webp">`,
          ar: '<p>م</p>',
        },
      }),
    );
    expect(created.status).toBe(201);
    const text = created.body.content.en as string;
    expect(text).toContain(`<img src="${r2Src}" alt="ok"`);
    expect(text).not.toContain('evil.example.com');
    expect(text).not.toContain('local.webp');
  });

  it('I18N-02 · published needs title+content in both locales; unpublished needs at least one', async () => {
    const arOnlyPublished = await api('post').send(
      goodBody({ content: { en: '', ar: '<p>م</p>' }, isPublished: true }),
    );
    expect(arOnlyPublished.status).toBe(422);
    expect(arOnlyPublished.body.code).toBe('VALIDATION_ERROR');

    const arOnlyDraft = await api('post').send(
      goodBody({ title: { en: '', ar: 'من نحن' }, content: { en: '', ar: '<p>م</p>' } }),
    );
    expect(arOnlyDraft.status).toBe(201);

    const publishHalf = await api('patch', `/${arOnlyDraft.body.id}`).send({
      expectedUpdatedAt: arOnlyDraft.body.updatedAt,
      isPublished: true,
    });
    expect(publishHalf.status).toBe(422);

    // Content that is only script sanitises to empty and fails the gate.
    const scriptOnly = await api('post').send(
      goodBody({ slug: 'faq', content: { en: '<script>x</script>', ar: '<script>y</script>' } }),
    );
    expect(scriptOnly.status).toBe(422);
  });

  it('ADM-08 · stale PATCH gets 409 STALE_UPDATE and the first change survives', async () => {
    const created = await api('post').send(goodBody()).expect(201);
    const loaded = created.body.updatedAt;
    await api('patch', `/${created.body.id}`)
      .send({ expectedUpdatedAt: loaded, title: { en: 'First', ar: 'الأول' } })
      .expect(200);
    const second = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: loaded,
      title: { en: 'Second', ar: 'الثاني' },
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('STALE_UPDATE');
    expect(second.body.details.current.title.en).toBe('First');
  });

  it('ADM-08 · writes revalidate page:{slug}; a rename also revalidates the old slug', async () => {
    const created = await api('post').send(goodBody()).expect(201);
    expect(revalidateMock).toHaveBeenLastCalledWith(['page:about'], expect.anything());

    const renamed = await api('patch', `/${created.body.id}`).send({
      expectedUpdatedAt: created.body.updatedAt,
      slug: 'about-us',
    });
    expect(renamed.status).toBe(200);
    expect(revalidateMock).toHaveBeenLastCalledWith(
      ['page:about-us', 'page:about'],
      expect.anything(),
    );

    await api('delete', `/${created.body.id}`).expect(204);
    expect(revalidateMock).toHaveBeenLastCalledWith(['page:about-us'], expect.anything());
  });
});
