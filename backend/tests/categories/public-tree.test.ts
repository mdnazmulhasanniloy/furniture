import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_categories_public_t009',
  );
});

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

const app = createApp();
const tree = () => request(app).get('/api/v1/categories');

const mkCategory = (slug: string, over: Record<string, unknown> = {}) =>
  prisma.category.create({
    data: {
      name: { en: `${slug} en`, ar: `${slug} ar` },
      slug,
      parentId: null,
      image: null,
      sortOrder: 0,
      isActive: true,
      ...over,
    },
  });

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
async function wipeCategories() {
  await prisma.product.deleteMany();
  // Clear self-references first: Prisma's emulated relation action refuses to delete referenced parents.
  await prisma.category.updateMany({ data: { parentId: null } });
  await prisma.category.deleteMany();
}
beforeEach(wipeCategories);
afterAll(async () => {
  await wipeCategories();
  await prisma.$disconnect();
});

describe('CAT-01 · GET /categories', () => {
  it('CAT-01 · tree returns active categories only, one level nested, sorted by sortOrder then slug', async () => {
    const b = await mkCategory('bedroom', { sortOrder: 1 });
    const a = await mkCategory('living-room', { sortOrder: 2 });
    await mkCategory('sofas', { parentId: a.id, sortOrder: 2 });
    await mkCategory('armchairs', { parentId: a.id, sortOrder: 1 });
    await mkCategory('hidden-child', { parentId: a.id, isActive: false });
    await mkCategory('hidden-root', { isActive: false, sortOrder: 0 });

    const res = await tree();
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(['bedroom', 'living-room']);
    expect(res.body[0].id).toBe(b.id);
    expect(res.body[0].children).toEqual([]);
    // Children sorted by sortOrder; the inactive child is omitted.
    expect(res.body[1].children.map((c: { slug: string }) => c.slug)).toEqual([
      'armchairs',
      'sofas',
    ]);
    const all = JSON.stringify(res.body);
    expect(all).not.toContain('hidden-root');
    expect(all).not.toContain('hidden-child');
  });

  it('CAT-01 · children of an inactive parent are hidden, not re-rooted', async () => {
    const parent = await mkCategory('outdoor', { isActive: false });
    await mkCategory('garden-chairs', { parentId: parent.id, isActive: true });
    const res = await tree();
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('garden-chairs');
  });

  it('CAT-01 · localized name (en+ar) and image are returned; no auth required', async () => {
    await mkCategory('dining', {
      name: { en: 'Dining', ar: 'غرفة الطعام' },
      image: {
        key: 'furnixa/test/2026/11/00000000-0000-4000-8000-000000000001.webp',
        url: 'https://cdn.test/furnixa/test/2026/11/00000000-0000-4000-8000-000000000001.webp',
        alt: { en: 'Dining room', ar: 'غرفة الطعام' },
      },
    });
    // No Authorization header: the route is public.
    const res = await tree();
    expect(res.status).toBe(200);
    const cat = res.body[0];
    expect(cat.name).toEqual({ en: 'Dining', ar: 'غرفة الطعام' });
    expect(cat.image.key).toBe('furnixa/test/2026/11/00000000-0000-4000-8000-000000000001.webp');
    expect(cat.image.url).toContain(cat.image.key);
    expect(cat.parentId).toBeNull();
    expect(cat.isActive).toBe(true);
  });

  it('CAT-01 · a root category stored without a parentId field (missing, not null) appears in the tree', async () => {
    // Null-vs-missing regression (CLAUDE.md rule 8): seeded categories have no parentId field at all.
    await prisma.category.create({
      data: { name: { en: 'Kids', ar: 'أطفال' }, slug: 'kids' },
    });
    const raw = await prisma.category.findRaw({ filter: { parentId: { $exists: false } } });
    expect(raw).toHaveLength(1); // precondition: the field really is missing
    const res = await tree();
    expect(res.status).toBe(200);
    expect(res.body.map((c: { slug: string }) => c.slug)).toEqual(['kids']);
    expect(res.body[0].parentId).toBeNull();
    expect(res.body[0].image).toBeNull();
  });
});
