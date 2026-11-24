import { execSync } from 'node:child_process';
import argon2 from 'argon2';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';
import { runSeed, type SeedOptions } from '../../prisma/seed/run.js';

const admin = {
  email: 'Owner@Example.com',
  password: 'Correct-Horse-Battery9',
  firstName: 'Sara',
  lastName: 'Alharbi',
};
const base: SeedOptions = {
  nodeEnv: 'test',
  demo: false,
  admin,
  argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
};

async function wipe() {
  await prisma.product.deleteMany(); // before categories: the relation blocks the other order
  await Promise.all([
    prisma.user.deleteMany(),
    prisma.category.deleteMany(),
    prisma.siteSetting.deleteMany(),
    prisma.homeSection.deleteMany(),
    prisma.page.deleteMany(),
    prisma.rateLimit.deleteMany(),
  ]);
}

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: 'pipe',
  });
});
beforeEach(wipe);
afterAll(async () => {
  await wipe();
  await prisma.$disconnect();
});

describe('seed (T-002)', () => {
  it('NFR-05 · prisma db push creates unique indexes (User.email, Category.slug, Product.slug, SiteSetting.key, RateLimit.key)', async () => {
    const name = { en: 'a', ar: 'ا' };
    const cat = await prisma.category.create({ data: { slug: 'dup', name } });
    const user = { email: 'x@x.com', passwordHash: 'h', firstName: 'a', lastName: 'b' };
    const product = {
      slug: 'dup-product',
      title: name,
      description: name,
      price: 1000,
      type: 'NEW' as const,
      condition: 'NEW' as const,
      categoryId: cat.id,
    };
    const setting = {
      key: 'dup-key',
      storeName: name,
      contactEmail: 'a@b.com',
      contactPhone: '+966500000000',
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
    };
    const rate = { key: 'rl:login:1.1.1.1', hits: 1, resetAt: new Date(Date.now() + 60_000) };

    await prisma.user.create({ data: user });
    await prisma.product.create({ data: product });
    await prisma.siteSetting.create({ data: setting });
    await prisma.rateLimit.create({ data: rate });

    await expect(prisma.category.create({ data: { slug: 'dup', name } })).rejects.toThrow();
    await expect(prisma.user.create({ data: user })).rejects.toThrow();
    await expect(prisma.product.create({ data: product })).rejects.toThrow();
    await expect(prisma.siteSetting.create({ data: setting })).rejects.toThrow();
    await expect(prisma.rateLimit.create({ data: rate })).rejects.toThrow();
    await prisma.rateLimit.deleteMany();
  });

  it('NFR-05 · seeded contact details come from SEED_CONTACT_* options', async () => {
    const logs: string[] = [];
    await runSeed(prisma, {
      ...base,
      contact: { email: 'hello@shop.sa', phone: '+966555555555' },
      log: (m) => logs.push(m),
    });
    const s = (await prisma.siteSetting.findUnique({ where: { key: 'default' } }))!;
    expect([s.contactEmail, s.contactPhone]).toEqual(['hello@shop.sa', '+966555555555']);
    expect(logs.some((m) => m.includes('WARNING'))).toBe(false);
  });

  it('NFR-05 · missing contact details fall back to placeholders and log a warning', async () => {
    const logs: string[] = [];
    await runSeed(prisma, { ...base, log: (m) => logs.push(m) });
    const s = (await prisma.siteSetting.findUnique({ where: { key: 'default' } }))!;
    expect([s.contactEmail, s.contactPhone]).toEqual(['placeholder@example.com', '+966500000000']);
    expect(logs.some((m) => m.includes('WARNING') && m.includes('admin dashboard'))).toBe(true);
  });

  it('NFR-05 · seed creates exactly 1 admin from env with an argon2id hash', async () => {
    await runSeed(prisma, base);
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    expect(admins).toHaveLength(1);
    const u = admins[0]!;
    expect(u.email).toBe('owner@example.com');
    expect([u.firstName, u.lastName, u.isVerified]).toEqual(['Sara', 'Alharbi', true]);
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(u.passwordHash, admin.password)).toBe(true);
  });

  it('NFR-05 · seed creates 6 categories with en and ar names', async () => {
    await runSeed(prisma, base);
    const cats = await prisma.category.findMany();
    expect(cats).toHaveLength(6);
    for (const c of cats) expect(c.name.en && c.name.ar).toBeTruthy();
  });

  it('NFR-05 · SiteSetting singleton has fee 0, threshold null, vat 0/true/true, SAR, ar default', async () => {
    await runSeed(prisma, base);
    const all = await prisma.siteSetting.findMany();
    expect(all).toHaveLength(1);
    const s = all[0]!;
    expect(s.key).toBe('default');
    expect(s.deliveryFee).toBe(0);
    expect(s.freeDeliveryThreshold).toBeNull();
    expect(s.vat).toMatchObject({ vatRate: 0, applyToDelivery: true, pricesIncludeVat: true });
    expect(s.currency).toBe('SAR');
    expect(s.defaultLocale).toBe('ar');
  });

  it('NFR-05 · seed creates the 6 active delivery cities with unique codes', async () => {
    await runSeed(prisma, base);
    const s = (await prisma.siteSetting.findFirst())!;
    expect(s.deliveryCities.map((c) => c.code).sort()).toEqual([
      'dammam',
      'jeddah',
      'khobar',
      'mecca',
      'medina',
      'riyadh',
    ]);
    expect(s.deliveryCities.every((c) => c.isActive && c.deliveryFee === null)).toBe(true);
  });

  it('NFR-05 · seed creates default home sections', async () => {
    await runSeed(prisma, base);
    const n = await prisma.homeSection.count();
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it('NFR-05 · seed creates 5 pages with en and ar; terms and privacy are unpublished placeholders', async () => {
    await runSeed(prisma, base);
    const pages = await prisma.page.findMany();
    expect(pages.map((p) => p.slug).sort()).toEqual([
      'about',
      'contact',
      'faq',
      'privacy',
      'terms',
    ]);
    for (const p of pages)
      expect(p.content.en && p.content.ar && p.title.en && p.title.ar).toBeTruthy();
    for (const slug of ['terms', 'privacy']) {
      const p = pages.find((x) => x.slug === slug)!;
      expect(p.isPublished).toBe(false);
      expect(p.content.en).toContain('PLACEHOLDER - replace before launch');
      expect(p.content.ar).toContain('نص مؤقت - يجب استبداله قبل الإطلاق');
    }
    for (const slug of ['about', 'faq', 'contact']) {
      expect(pages.find((x) => x.slug === slug)!.isPublished).toBe(true);
    }
  });

  it('NFR-05 · base seed creates no products', async () => {
    await runSeed(prisma, base);
    expect(await prisma.product.count()).toBe(0);
  });

  it('NFR-05 · demo seed creates 12 products: 6 NEW and 6 RESALE, bilingual, integer prices, no images', async () => {
    const logs: string[] = [];
    await runSeed(prisma, { ...base, demo: true, log: (m) => logs.push(m) });
    const products = await prisma.product.findMany();
    expect(products).toHaveLength(12);
    expect(products.filter((p) => p.type === 'NEW')).toHaveLength(6);
    expect(products.filter((p) => p.type === 'RESALE')).toHaveLength(6);
    for (const p of products) {
      expect(p.title.en && p.title.ar && p.description.en && p.description.ar).toBeTruthy();
      expect(Number.isInteger(p.price) && p.price > 0).toBe(true);
      expect(p.status).toBe('PUBLISHED');
      expect(p.images).toEqual([]);
    }
    expect(logs.some((m) => m.includes('placeholder'))).toBe(true);
  });

  it('NFR-05 · demo seed refuses to run when NODE_ENV=production', async () => {
    await expect(runSeed(prisma, { ...base, demo: true, nodeEnv: 'production' })).rejects.toThrow(
      /production/,
    );
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.product.count()).toBe(0);
  });

  it('NFR-05 · seed is idempotent', async () => {
    await runSeed(prisma, { ...base, demo: true });
    const counts = async () => [
      await prisma.user.count(),
      await prisma.category.count(),
      await prisma.siteSetting.count(),
      await prisma.homeSection.count(),
      await prisma.page.count(),
      await prisma.product.count(),
    ];
    const first = await counts();
    const second = await runSeed(prisma, { ...base, demo: true });
    expect(await counts()).toEqual(first);
    expect(second).toEqual({
      admin: false,
      categories: 0,
      siteSetting: false,
      homeSections: 0,
      pages: 0,
      products: 0,
    });
  });

  it('NFR-05 · seed does not overwrite an admin-edited SiteSetting (vat 15 stays 15)', async () => {
    await runSeed(prisma, base);
    await prisma.siteSetting.update({
      where: { key: 'default' },
      data: {
        deliveryFee: 2500,
        freeDeliveryThreshold: 50000,
        vat: { vatRate: 15, applyToDelivery: false, pricesIncludeVat: false },
        deliveryCities: [
          {
            code: 'riyadh',
            name: { en: 'Riyadh', ar: 'الرياض' },
            isActive: true,
            sortOrder: 1,
            deliveryFee: 1000,
          },
        ],
      },
    });
    await runSeed(prisma, base);
    const s = (await prisma.siteSetting.findUnique({ where: { key: 'default' } }))!;
    expect(s.vat).toMatchObject({ vatRate: 15, applyToDelivery: false, pricesIncludeVat: false });
    expect(s.deliveryFee).toBe(2500);
    expect(s.freeDeliveryThreshold).toBe(50000);
    expect(s.deliveryCities).toHaveLength(1);
  });

  it('NFR-05 · seed does not reset an existing admin password', async () => {
    await runSeed(prisma, base);
    const hash = await argon2.hash('changed-by-admin-123', {
      type: argon2.argon2id,
      memoryCost: 1024,
      timeCost: 1,
    });
    await prisma.user.updateMany({ data: { passwordHash: hash, firstName: 'Renamed' } });
    await runSeed(prisma, base);
    const u = (await prisma.user.findFirst())!;
    expect(u.passwordHash).toBe(hash);
    expect(u.firstName).toBe('Renamed');
    expect(await prisma.user.count()).toBe(1);
  });

  it('NFR-05 · seed does not overwrite edited home sections', async () => {
    await runSeed(prisma, base);
    await prisma.homeSection.deleteMany({ where: { type: { not: 'NEW_ARRIVALS' } } });
    await prisma.homeSection.updateMany({
      data: { title: { en: 'Edited', ar: 'معدل' }, sortOrder: 99, isVisible: false },
    });
    await runSeed(prisma, base);
    const rows = await prisma.homeSection.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sortOrder: 99,
      isVisible: false,
      title: { en: 'Edited', ar: 'معدل' },
    });
  });

  it('NFR-05 · seed does not overwrite edited pages or categories', async () => {
    await runSeed(prisma, base);
    await prisma.page.update({
      where: { slug: 'terms' },
      data: { isPublished: true, content: { en: 'Real terms', ar: 'شروط حقيقية' } },
    });
    await prisma.category.update({
      where: { slug: 'bedroom' },
      data: { name: { en: 'Sleep', ar: 'نوم' } },
    });
    await runSeed(prisma, base);
    const t = (await prisma.page.findUnique({ where: { slug: 'terms' } }))!;
    expect(t.isPublished).toBe(true);
    expect(t.content.en).toBe('Real terms');
    expect((await prisma.category.findUnique({ where: { slug: 'bedroom' } }))!.name.en).toBe(
      'Sleep',
    );
  });

  it('NFR-05 · seed fails clearly when admin env vars are missing', async () => {
    await expect(runSeed(prisma, { ...base, admin: { email: 'a@b.com' } })).rejects.toThrow(
      /ADMIN_PASSWORD.*ADMIN_FIRST_NAME.*ADMIN_LAST_NAME/,
    );
    // the one password policy, not a length of its own: the message names every unmet rule
    await expect(
      runSeed(prisma, { ...base, admin: { ...admin, password: 'short' } }),
    ).rejects.toThrow(/password policy \(unmet: length, upper, digit, symbol\)/);
    for (const weak of [
      'alllower9!',
      'ALLUPPER9!',
      'NoDigits!!',
      'NoSymbol99',
      'Aa9!' + 'x'.repeat(125),
    ]) {
      await expect(
        runSeed(prisma, { ...base, admin: { ...admin, password: weak } }),
      ).rejects.toThrow(/password policy/);
    }
    expect(await prisma.user.count()).toBe(0);
  });
});
