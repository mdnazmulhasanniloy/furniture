import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_products_public_list_t010',
  );
});

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { buildSearchText } from '../../src/lib/searchText.js';

const app = createApp();
const list = (query: Record<string, string> = {}) =>
  request(app).get('/api/v1/products').query(query);

let livingRoomId = '';
let sofasId = ''; // child of living-room
let outdoorId = '';

type Seed = {
  slug: string;
  title?: { en: string; ar: string };
  categoryId?: string;
  type?: 'NEW' | 'RESALE';
  condition?: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR';
  price?: number;
  stock?: number;
  isFeatured?: boolean;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  material?: string | null;
  createdAt?: Date;
};

async function seedProduct(p: Seed) {
  const title = p.title ?? { en: `${p.slug} en`, ar: `${p.slug} ar` };
  return prisma.product.create({
    data: {
      slug: p.slug,
      title,
      description: { en: 'desc en', ar: 'وصف' },
      type: p.type ?? 'NEW',
      condition: p.condition ?? (p.type === 'RESALE' ? 'GOOD' : 'NEW'),
      price: p.price ?? 10_000,
      stock: p.stock ?? 5,
      categoryId: p.categoryId ?? livingRoomId,
      images: [],
      isFeatured: p.isFeatured ?? false,
      status: p.status ?? 'PUBLISHED',
      searchText: buildSearchText(title),
      sku: null,
      conditionNotes: null,
      compareAtPrice: null,
      dimensions: null,
      material: p.material ?? null,
      color: null,
      ...(p.createdAt && { createdAt: p.createdAt }),
    },
  });
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  const livingRoom = await prisma.category.create({
    data: {
      name: { en: 'Living room', ar: 'غرفة المعيشة' },
      slug: 'living-room',
      image: null,
      parentId: null,
    },
  });
  livingRoomId = livingRoom.id;
  sofasId = (
    await prisma.category.create({
      data: {
        name: { en: 'Sofas', ar: 'كنب' },
        slug: 'sofas',
        image: null,
        parentId: livingRoomId,
      },
    })
  ).id;
  outdoorId = (
    await prisma.category.create({
      data: { name: { en: 'Outdoor', ar: 'خارجي' }, slug: 'outdoor', image: null, parentId: null },
    })
  ).id;

  const t = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min));
  await seedProduct({ slug: 'draft-sofa', status: 'DRAFT', createdAt: t(1) });
  await seedProduct({ slug: 'archived-sofa', status: 'ARCHIVED', createdAt: t(2) });
  await seedProduct({
    slug: 'oak-table',
    title: { en: 'Oak Dining Table', ar: 'طاولة طعام' },
    price: 50_000,
    material: 'Oak wood',
    createdAt: t(3),
  });
  await seedProduct({
    slug: 'velvet-sofa',
    title: { en: 'Velvet Sofa a.b 2026', ar: 'كنبة مخملية' },
    categoryId: sofasId,
    price: 150_000,
    isFeatured: true,
    material: 'Velvet',
    createdAt: t(4),
  });
  await seedProduct({
    slug: 'used-armchair',
    // Composed spellings: hamza alef + ta marbuta + diacritic; normalised to plain forms.
    title: { en: 'Pre-owned Armchair axb', ar: 'أريكةٌ مستعملة' },
    type: 'RESALE',
    condition: 'GOOD',
    price: 20_000,
    stock: 0,
    createdAt: t(5),
  });
  await seedProduct({
    slug: 'patio-set',
    title: { en: 'Patio Set ٢٠٢٦', ar: 'طقم حديقة' },
    categoryId: outdoorId,
    type: 'RESALE',
    condition: 'FAIR',
    price: 80_000,
    createdAt: t(6),
  });
});
afterAll(async () => {
  await prisma.product.deleteMany();
  // Clear self-references first: Prisma's emulated relation action refuses to delete referenced parents.
  await prisma.category.updateMany({ data: { parentId: null } });
  await prisma.category.deleteMany();
  await prisma.$disconnect();
});

const slugs = (res: { body: { items: { slug: string }[] } }) => res.body.items.map((i) => i.slug);

describe('PROD-01 · public product listing', () => {
  it('PROD-01 · returns only PUBLISHED products', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(slugs(res)).toEqual(['patio-set', 'used-armchair', 'velvet-sofa', 'oak-table']);
    expect(res.body.meta).toEqual({ page: 1, limit: 24, total: 4, totalPages: 1 });
  });

  it('PROD-01 · category filter by slug includes its sub-categories; unknown slug returns an empty page', async () => {
    const parent = await list({ category: 'living-room' });
    expect(slugs(parent).sort()).toEqual(['oak-table', 'used-armchair', 'velvet-sofa']);
    const child = await list({ category: 'sofas' });
    expect(slugs(child)).toEqual(['velvet-sofa']);
    const unknown = await list({ category: 'no-such-category' });
    expect(unknown.status).toBe(200);
    expect(unknown.body.items).toEqual([]);
    expect(unknown.body.meta.total).toBe(0);
  });

  it('PROD-01 · type filter', async () => {
    expect(slugs(await list({ type: 'RESALE' })).sort()).toEqual(['patio-set', 'used-armchair']);
    expect(slugs(await list({ type: 'NEW' })).sort()).toEqual(['oak-table', 'velvet-sofa']);
  });

  it('PROD-01 · condition filter accepts multiple comma-separated grades', async () => {
    expect(slugs(await list({ condition: 'GOOD,FAIR' })).sort()).toEqual([
      'patio-set',
      'used-armchair',
    ]);
    expect(slugs(await list({ condition: 'FAIR' }))).toEqual(['patio-set']);
    expect((await list({ condition: 'SHABBY' })).status).toBe(422);
  });

  it('PROD-01 · price range is inclusive in halalas', async () => {
    expect(slugs(await list({ minPrice: '20000', maxPrice: '80000' })).sort()).toEqual([
      'oak-table',
      'patio-set',
      'used-armchair',
    ]);
    expect(slugs(await list({ minPrice: '150000' }))).toEqual(['velvet-sofa']);
  });

  it('PROD-01 · material filter matches case-insensitively', async () => {
    expect(slugs(await list({ material: 'oak wood' }))).toEqual(['oak-table']);
    expect(slugs(await list({ material: 'VELVET' }))).toEqual(['velvet-sofa']);
    expect((await list({ material: 'Oak' })).body.items).toEqual([]); // exact, not contains
  });

  it('PROD-01 · regex characters in the material filter are literal: "o.k wood" does not match "Oak wood" and "(" does not error', async () => {
    // mode:'insensitive' equals is also $regex-backed on MongoDB (rule 9): must be escaped.
    expect((await list({ material: 'o.k wood' })).body.items).toEqual([]);
    const paren = await list({ material: '(' });
    expect(paren.status).toBe(200);
    expect(paren.body.items).toEqual([]);
  });

  it('PROD-01 · inStock=true hides stock 0', async () => {
    const res = await list({ inStock: 'true' });
    expect(slugs(res)).not.toContain('used-armchair');
    expect(res.body.meta.total).toBe(3);
  });

  it('PROD-01 · featured filter', async () => {
    expect(slugs(await list({ featured: 'true' }))).toEqual(['velvet-sofa']);
  });

  it('PROD-01 · q searches the English and Arabic title', async () => {
    expect(slugs(await list({ q: 'oak dining' }))).toEqual(['oak-table']);
    expect(slugs(await list({ q: 'مخملية' }))).toEqual(['velvet-sofa']);
    expect((await list({ q: 'zzz-no-match' })).body.items).toEqual([]);
  });

  it('I18N-02 · an Arabic query with a different alef/ta-marbuta spelling still matches', async () => {
    // Stored: "أريكةٌ" (hamza alef, ta marbuta, damma). Query: plain alef + ha, no diacritics.
    expect(slugs(await list({ q: 'اريكه' }))).toEqual(['used-armchair']);
    // Arabic-Indic digits in the stored title match an ASCII query and vice versa.
    expect(slugs(await list({ q: '2026' })).sort()).toEqual(['patio-set', 'velvet-sofa']);
    expect(slugs(await list({ q: '٢٠٢٦' })).sort()).toEqual(['patio-set', 'velvet-sofa']);
  });

  it('PROD-01 · regex characters in q are literal: "a.b" does not match "axb" and "(" does not error', async () => {
    expect(slugs(await list({ q: 'a.b' }))).toEqual(['velvet-sofa']); // not used-armchair ("axb")
    const paren = await list({ q: '(' });
    expect(paren.status).toBe(200);
    expect(paren.body.items).toEqual([]);
    expect((await list({ q: 'a'.repeat(101) })).status).toBe(422);
  });

  it('PROD-01 · q matches the plural and the singular of a word (sofas / sofa, benches / bench)', async () => {
    expect(slugs(await list({ q: 'sofas' }))).toEqual(['velvet-sofa']);
    expect(slugs(await list({ q: 'SOFA' }))).toEqual(['velvet-sofa']);
    expect(slugs(await list({ q: 'tables' }))).toEqual(['oak-table']);
    expect(slugs(await list({ q: 'armchairs' }))).toEqual(['used-armchair']);
  });

  it('PROD-01 · q also searches the category name, the description and the material, in both languages; every word must match', async () => {
    const extra = await seedProduct({ slug: 'chesterfield', title: { en: 'Classic Chesterfield Three-Seater', ar: 'تشيسترفيلد' }, categoryId: sofasId, material: 'Leather' });
    await prisma.product.update({ where: { id: extra.id }, data: { description: { en: 'Deep buttoned seat', ar: 'مقعد مبطن' } } });
    try {
      expect(slugs(await list({ q: 'sofa' })).sort()).toEqual(['chesterfield', 'velvet-sofa']); // category name
      expect(slugs(await list({ q: 'كنب' })).sort()).toEqual(['chesterfield', 'velvet-sofa']); // category name, Arabic
      expect(slugs(await list({ q: 'buttoned' }))).toEqual(['chesterfield']); // description
      expect(slugs(await list({ q: 'مبطن' }))).toEqual(['chesterfield']); // description, Arabic
      expect(slugs(await list({ q: 'leather' }))).toEqual(['chesterfield']); // material
      expect(slugs(await list({ q: 'sofas leather' }))).toEqual(['chesterfield']); // all words, plural form
      expect(slugs(await list({ q: 'sofa oak' }))).toEqual([]); // one word missing
      expect(slugs(await list({ q: '.*' }))).toEqual([]); // regex characters stay literal
    } finally {
      await prisma.product.delete({ where: { id: extra.id } });
    }
  });

  it('PROD-01 · sort orders: newest, price_asc, price_desc, featured', async () => {
    expect(slugs(await list({ sort: 'newest' }))).toEqual([
      'patio-set',
      'used-armchair',
      'velvet-sofa',
      'oak-table',
    ]);
    expect(slugs(await list({ sort: 'price_asc' }))).toEqual([
      'used-armchair',
      'oak-table',
      'patio-set',
      'velvet-sofa',
    ]);
    expect(slugs(await list({ sort: 'price_desc' }))).toEqual([
      'velvet-sofa',
      'patio-set',
      'oak-table',
      'used-armchair',
    ]);
    expect(slugs(await list({ sort: 'featured' }))[0]).toBe('velvet-sofa');
  });

  it('PROD-01 · pagination: page/limit with meta; limit capped at 100', async () => {
    const page1 = await list({ limit: '2', sort: 'newest' });
    expect(slugs(page1)).toEqual(['patio-set', 'used-armchair']);
    expect(page1.body.meta).toEqual({ page: 1, limit: 2, total: 4, totalPages: 2 });
    const page2 = await list({ limit: '2', page: '2', sort: 'newest' });
    expect(slugs(page2)).toEqual(['velvet-sofa', 'oak-table']);
    expect((await list({ limit: '101' })).status).toBe(422);
    expect((await list({ page: '0' })).status).toBe(422);
  });

  it('PROD-01 · responses expose the category but never searchText', async () => {
    const res = await list({ category: 'sofas' });
    const item = res.body.items[0];
    expect(item.category).toMatchObject({ slug: 'sofas', parentId: livingRoomId });
    expect(item.searchText).toBeUndefined();
    expect(item.sku).toBeNull();
    expect(item.compareAtPrice).toBeNull();
  });
});
