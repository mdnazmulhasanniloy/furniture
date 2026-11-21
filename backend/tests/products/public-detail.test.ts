import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_products_public_detail_t010',
  );
});

import { createApp } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';
import { buildSearchText } from '../../src/lib/searchText.js';

const app = createApp();
const detail = (slug: string) => request(app).get(`/api/v1/products/${slug}`);

let categoryId = '';
let otherCategoryId = '';

async function seedProduct(p: {
  slug: string;
  categoryId?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  createdAt?: Date;
}) {
  const title = { en: `${p.slug} en`, ar: `${p.slug} ar` };
  return prisma.product.create({
    data: {
      slug: p.slug,
      title,
      description: { en: 'desc', ar: 'وصف' },
      type: 'RESALE',
      condition: 'LIKE_NEW',
      price: 12_500,
      compareAtPrice: 20_000,
      stock: 1,
      categoryId: p.categoryId ?? categoryId,
      images: [],
      dimensions: { widthCm: 80, depthCm: 90, heightCm: 100, weightKg: 12.5 },
      material: 'Leather',
      color: 'Brown',
      conditionNotes: { en: 'Light wear', ar: 'استخدام خفيف' },
      sku: `SKU-${p.slug}`,
      status: p.status ?? 'PUBLISHED',
      searchText: buildSearchText(title),
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
  categoryId = (
    await prisma.category.create({
      data: {
        name: { en: 'Bedroom', ar: 'غرفة النوم' },
        slug: 'bedroom',
        image: null,
        parentId: null,
      },
    })
  ).id;
  otherCategoryId = (
    await prisma.category.create({
      data: { name: { en: 'Office', ar: 'مكتب' }, slug: 'office', image: null, parentId: null },
    })
  ).id;

  const t = (min: number) => new Date(Date.UTC(2026, 10, 2, 8, min));
  await seedProduct({ slug: 'main-bed', createdAt: t(0) });
  // Related candidates: 9 published siblings (one more than the cap), one draft, one other-category.
  for (let i = 1; i <= 9; i++) await seedProduct({ slug: `sibling-${i}`, createdAt: t(i) });
  await seedProduct({ slug: 'draft-sibling', status: 'DRAFT', createdAt: t(30) });
  await seedProduct({ slug: 'office-desk', categoryId: otherCategoryId, createdAt: t(31) });
  await seedProduct({ slug: 'archived-bed', status: 'ARCHIVED', createdAt: t(32) });
});
afterAll(async () => {
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.$disconnect();
});

describe('PROD-02 · public product detail', () => {
  it('PROD-02 · returns the full product by slug including category, dimensions and updatedAt', async () => {
    const res = await detail('main-bed');
    expect(res.status).toBe(200);
    expect(res.body.product).toMatchObject({
      slug: 'main-bed',
      type: 'RESALE',
      condition: 'LIKE_NEW',
      conditionNotes: { en: 'Light wear', ar: 'استخدام خفيف' },
      price: 12_500,
      compareAtPrice: 20_000,
      material: 'Leather',
      color: 'Brown',
      sku: 'SKU-main-bed',
      dimensions: { widthCm: 80, depthCm: 90, heightCm: 100, weightKg: 12.5 },
      category: { slug: 'bedroom' },
    });
    expect(typeof res.body.product.updatedAt).toBe('string');
    expect(res.body.product.searchText).toBeUndefined();
  });

  it('PROD-02 · DRAFT, ARCHIVED and unknown slugs return 404', async () => {
    for (const slug of ['draft-sibling', 'archived-bed', 'never-existed']) {
      const res = await detail(slug);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    }
  });

  it('PROD-02 · related: up to 8 PUBLISHED same-category products, newest first, excluding itself', async () => {
    const res = await detail('main-bed');
    const related = res.body.related as { slug: string }[];
    expect(related).toHaveLength(8);
    expect(related.map((r) => r.slug)).toEqual([
      'sibling-9',
      'sibling-8',
      'sibling-7',
      'sibling-6',
      'sibling-5',
      'sibling-4',
      'sibling-3',
      'sibling-2',
    ]);
    const all = related.map((r) => r.slug);
    expect(all).not.toContain('main-bed');
    expect(all).not.toContain('draft-sibling');
    expect(all).not.toContain('office-desk');
  });
});
