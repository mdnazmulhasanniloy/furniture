import { execSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database: this file wipes products, orders and customers and must not race other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_demo_t078',
  );
});
vi.mock('@aws-sdk/client-s3', async () => (await import('../../helpers/s3Mock.js')).clientS3Module);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  async () => (await import('../../helpers/s3Mock.js')).presignerModule,
);

import path from 'node:path';
import { computePricing } from '../../../src/lib/pricing.js';
import { hashPassword, verifyPassword } from '../../../src/lib/password.js';
import { normalizeSaudiPhone } from '../../../src/lib/phone.js';
import { prisma } from '../../../src/lib/prisma.js';
import { keyPrefix } from '../../../src/lib/r2.js';
import { createSectionBody } from '../../../src/modules/cms/schema.js';
import { TRANSITIONS } from '../../../src/modules/orders/service.js';
import { loadManifest, type ManifestImage } from '../../../scripts/demo-data/images.js';
import { seedOrders } from '../../../scripts/demo-data/orders.js';
import { planReset, resetDemoData, demoPrefix } from '../../../scripts/demo-data/reset.js';
import { run } from '../../../scripts/demo-data/reset-and-seed.js';
import { seedDemoData, type SeedResult } from '../../../scripts/demo-data/seed.js';
import { resetS3, s3State } from '../../helpers/s3Mock.js';

const PASSWORD = 'demo-password-123';
const jpegBytes = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);
const fakeImage = async () => ({
  bytes: jpegBytes,
  contentType: 'image/jpeg' as const,
  width: 800,
  height: 600,
});

let manifest: ManifestImage[] = [];
let adminId = '';
let seeded: SeedResult;
const now = new Date();
const quiet = () => undefined;

async function prepareBase() {
  await prisma.siteSetting.deleteMany();
  await prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'shop@example.com',
      contactPhone: '+966500000000',
      deliveryFee: 3_000,
      freeDeliveryThreshold: 500_000,
      vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      deliveryCities: [
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
          isActive: true,
          sortOrder: 2,
          deliveryFee: 4_500,
        },
        {
          code: 'dammam',
          name: { en: 'Dammam', ar: 'الدمام' },
          isActive: true,
          sortOrder: 3,
          deliveryFee: null,
        },
        {
          code: 'old-town',
          name: { en: 'Old Town', ar: 'القديمة' },
          isActive: false,
          sortOrder: 4,
          deliveryFee: null,
        },
      ],
    },
  });
}

async function seedAll() {
  seeded = await seedDemoData(prisma, {
    adminId,
    manifest,
    imageSource: fakeImage,
    customerPassword: PASSWORD,
    now,
    log: quiet,
  });
  await seedOrders(prisma, {
    adminId,
    customers: seeded.customers,
    products: seeded.products,
    now,
    log: quiet,
  });
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  manifest = await loadManifest(path.resolve('scripts/demo-data/images.json'));
  await prepareBase();
  adminId = (
    await prisma.user.create({
      data: {
        firstName: 'Ad',
        lastName: 'Min',
        email: 'admin-demo@example.com',
        passwordHash: await hashPassword('x'.repeat(12)),
        role: 'ADMIN',
        isVerified: true,
        invitedById: null,
      },
    })
  ).id;
  await prisma.page.create({
    data: {
      slug: 'about',
      title: { en: 'a', ar: 'ب' },
      content: { en: 'a', ar: 'ب' },
      isPublished: true,
    },
  });
  resetS3();
  await seedAll();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('T-078 · demo catalogue counts and invariants', () => {
  it('T-078 · 8 top-level categories with images, one level of sub-categories, bilingual', async () => {
    const all = await prisma.category.findMany();
    const top = all.filter((c) => !c.parentId);
    expect(top).toHaveLength(8);
    expect(top.every((c) => c.image)).toBe(true);
    const children = all.filter((c) => c.parentId);
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((c) => top.some((t) => t.id === c.parentId))).toBe(true);
    for (const c of all) expect(c.name.en && c.name.ar).toBeTruthy();
  });

  it('T-078 · 32 products: 16 NEW and 16 RESALE with evenly spread conditions', async () => {
    const products = await prisma.product.findMany();
    expect(products).toHaveLength(32);
    expect(products.filter((p) => p.type === 'NEW')).toHaveLength(16);
    const resale = products.filter((p) => p.type === 'RESALE');
    expect(resale).toHaveLength(16);
    const by = (c: string) => resale.filter((p) => p.condition === c).length;
    const counts = [by('LIKE_NEW'), by('GOOD'), by('FAIR')];
    expect(counts.reduce((a, b) => a + b, 0)).toBe(16);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(
      products
        .filter((p) => p.type === 'NEW')
        .every((p) => p.condition === 'NEW' && p.conditionNotes === null),
    ).toBe(true);
    expect(resale.every((p) => p.conditionNotes?.en && p.conditionNotes?.ar)).toBe(true);
  });

  it('T-078 · stock: resale 1 (0 when sold out), new 3-20, exactly 2 sold out and 2 drafts, 8 featured, 6 compare-at', async () => {
    const products = await prisma.product.findMany();
    expect(products.filter((p) => p.stock === 0)).toHaveLength(2);
    expect(products.filter((p) => p.status === 'DRAFT')).toHaveLength(2);
    expect(products.filter((p) => p.isFeatured)).toHaveLength(8);
    expect(products.filter((p) => p.compareAtPrice !== null)).toHaveLength(6);
    for (const p of products.filter((x) => x.type === 'RESALE'))
      expect(p.stock, p.slug).toBeLessThanOrEqual(1);
    for (const p of products.filter((x) => x.type === 'RESALE' && x.stock !== 0))
      expect(p.stock).toBe(1);
    for (const p of products.filter((x) => x.type === 'NEW')) {
      expect(p.stock, p.slug).toBeGreaterThanOrEqual(3);
      expect(p.stock, p.slug).toBeLessThanOrEqual(20);
    }
    for (const p of products.filter((x) => x.compareAtPrice !== null))
      expect(p.compareAtPrice!).toBeGreaterThan(p.price);
    expect(
      products.filter((p) => p.isFeatured).every((p) => p.status === 'PUBLISHED' && p.stock > 0),
    ).toBe(true);
  });

  it('T-078 · prices are integer halalas between 150 and 12,000 SAR; every text exists in en and ar', async () => {
    const products = await prisma.product.findMany();
    for (const p of products) {
      expect(Number.isInteger(p.price), p.slug).toBe(true);
      expect(p.price).toBeGreaterThanOrEqual(15_000);
      expect(p.price).toBeLessThanOrEqual(1_200_000);
      expect(p.title.en.length && p.title.ar.length).toBeGreaterThan(0);
      expect(p.description.en.length && p.description.ar.length).toBeGreaterThan(0);
      expect(/[؀-ۿ]/.test(p.title.ar), `${p.slug} ar title is Arabic`).toBe(true);
      expect(p.sku && p.material && p.color).toBeTruthy();
      expect(
        p.dimensions?.widthCm &&
          p.dimensions.depthCm &&
          p.dimensions.heightCm &&
          p.dimensions.weightKg,
      ).toBeTruthy();
      expect(p.searchText.length).toBeGreaterThan(0);
    }
    expect(new Set(products.map((p) => p.sku)).size).toBe(32);
    expect(Math.min(...products.map((p) => p.price))).toBe(15_000);
    expect(Math.max(...products.map((p) => p.price))).toBe(1_200_000);
  });

  it('T-078 · every product has 2-4 images behaving like admin uploads (key under the demo prefix, url from key, size, attached)', async () => {
    const products = await prisma.product.findMany();
    const uploads = new Map((await prisma.upload.findMany()).map((u) => [u.key, u]));
    for (const p of products) {
      expect(p.images.length, p.slug).toBeGreaterThanOrEqual(2);
      expect(p.images.length, p.slug).toBeLessThanOrEqual(4);
      expect(new Set(p.images.map((i) => i.key)).size).toBe(p.images.length);
      for (const img of p.images) {
        expect(img.key.startsWith(demoPrefix())).toBe(true);
        expect(img.url).toBe(`${process.env.R2_PUBLIC_BASE_URL}/${img.key}`);
        expect(img.width).toBe(800);
        expect(img.height).toBe(600);
        expect(img.alt?.en && img.alt?.ar).toBeTruthy();
        const up = uploads.get(img.key);
        expect(up?.scope).toBe('admin');
        expect(up?.attachedAt).toBeInstanceOf(Date);
        expect(up?.uploadedById).toBe(adminId);
        expect(s3State.objects.get(img.key)?.ContentType).toBe('image/jpeg');
      }
    }
    expect(demoPrefix()).toBe(`${keyPrefix()}demo/`);
  });

  it('T-078 · 3 active banners with desktop + mobile image, bilingual copy, shop CTAs and one scheduled for the future', async () => {
    const banners = await prisma.banner.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(banners).toHaveLength(3);
    for (const b of banners) {
      expect(b.isActive).toBe(true);
      expect(b.imageDesktop.key && b.imageMobile?.key).toBeTruthy();
      expect(
        b.title.en &&
          b.title.ar &&
          b.subtitle?.en &&
          b.subtitle?.ar &&
          b.ctaLabel?.en &&
          b.ctaLabel?.ar,
      ).toBeTruthy();
      expect(b.ctaHref).toMatch(/^\/shop\?/);
    }
    expect(banners.filter((b) => b.startsAt && b.startsAt > now)).toHaveLength(1);
  });

  it('T-078 · the six home sections exist, their config passes the CMS schema and testimonials are marked demo', async () => {
    const sections = await prisma.homeSection.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(sections.map((s) => s.type).sort()).toEqual(
      [
        'CATEGORY_GRID',
        'FEATURED_PRODUCTS',
        'NEW_ARRIVALS',
        'PROMO_BANNER',
        'RESALE_PICKS',
        'TESTIMONIALS',
      ].sort(),
    );
    for (const s of sections) {
      const parsed = createSectionBody.safeParse({
        type: s.type,
        title: s.title,
        subtitle: s.subtitle,
        config: s.config,
        sortOrder: s.sortOrder,
        isVisible: s.isVisible,
      });
      expect(parsed.success, `${s.type}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
    const t = sections.find((s) => s.type === 'TESTIMONIALS')!;
    const list = (
      t.config as { testimonials: { name: string; quote: { en: string; ar: string } }[] }
    ).testimonials;
    expect(list.length).toBeGreaterThan(0);
    for (const x of list) {
      expect(x.name).toContain('Demo customer');
      expect(x.name).toContain('عميل تجريبي');
      expect(x.quote.en).toMatch(/DEMO/);
      expect(x.quote.ar).toContain('تجريبي');
    }
    const featured = sections.find((s) => s.type === 'FEATURED_PRODUCTS')!;
    expect((featured.config as { productIds: string[] }).productIds).toHaveLength(8);
    const promo = sections.find((s) => s.type === 'PROMO_BANNER')!;
    expect(seeded.bannerIds).toContain((promo.config as { bannerId: string }).bannerId);
  });

  it('T-078 · 12 verified demo customers on example.com with the demo password, Saudi mobiles and addresses in active cities', async () => {
    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: { addresses: true },
    });
    expect(customers).toHaveLength(12);
    const active = new Set(['riyadh', 'jeddah', 'dammam']);
    for (const u of customers) {
      expect(u.email.endsWith('@example.com')).toBe(true);
      expect(u.isVerified).toBe(true);
      expect(await verifyPassword(u.passwordHash, PASSWORD)).toBe(true);
      expect(u.phone).toBe(normalizeSaudiPhone(u.phone));
      expect(u.addresses).toHaveLength(1);
      const a = u.addresses[0]!;
      expect(active.has(a.cityCode)).toBe(true);
      expect(a.phone).toBe(normalizeSaudiPhone(a.phone));
      expect(a.isDefault).toBe(true);
    }
    expect(new Set(customers.map((u) => u.email)).size).toBe(12);
  });

  it('T-078 · optional fields are written as explicit null, so null filters match (CLAUDE.md rule 8)', async () => {
    expect(await prisma.user.count({ where: { role: 'CUSTOMER', invitedById: null } })).toBe(12);
    expect(await prisma.user.count({ where: { role: 'CUSTOMER', lockedUntil: null } })).toBe(12);
    expect(
      await prisma.product.count({ where: { type: 'NEW', conditionNotes: { is: null } } }),
    ).toBe(16);
  });
});

describe('T-078 · demo orders', () => {
  it('T-078 · about 40 orders over the last 30 days covering every status, with COD refused-at-door cancellations', async () => {
    const orders = await prisma.order.findMany();
    expect(orders).toHaveLength(40);
    expect(new Set(orders.map((o) => o.status))).toEqual(
      new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
    );
    expect(orders.filter((o) => o.adminNote === 'COD refused at the door')).toHaveLength(3);
    const cancelledRefused = orders.filter(
      (o) =>
        o.status === 'CANCELLED' && o.statusHistory.some((e) => e.status === 'OUT_FOR_DELIVERY'),
    );
    expect(cancelledRefused).toHaveLength(3);
    const oldest = Math.min(...orders.map((o) => o.createdAt.getTime()));
    expect(now.getTime() - oldest).toBeLessThanOrEqual(30 * 86_400_000);
    expect(Math.max(...orders.map((o) => o.createdAt.getTime()))).toBeLessThanOrEqual(
      now.getTime(),
    );
  });

  it('T-078 · totals, delivery fee and VAT equal what computePricing returns; money is integer halalas', async () => {
    const settings = (await prisma.siteSetting.findUnique({ where: { key: 'default' } }))!;
    for (const o of await prisma.order.findMany()) {
      const city = settings.deliveryCities.find((c) => c.code === o.address.cityCode);
      const p = computePricing({
        lines: o.items.map((i) => ({ unitPrice: i.unitPrice, qty: i.qty })),
        city: { deliveryFee: city?.deliveryFee ?? null },
        settings: {
          deliveryFee: settings.deliveryFee,
          freeDeliveryThreshold: settings.freeDeliveryThreshold,
          vat: settings.vat,
        },
      });
      expect(
        { subtotal: o.subtotal, fee: o.deliveryFee, vat: o.vat.vatAmount, total: o.total },
        o.orderNo,
      ).toEqual({
        subtotal: p.subtotal,
        fee: p.deliveryFee,
        vat: p.vat.vatAmount,
        total: p.total,
      });
      for (const n of [
        o.subtotal,
        o.deliveryFee,
        o.total,
        o.vat.vatAmount,
        ...o.items.flatMap((i) => [i.unitPrice, i.lineTotal]),
      ]) {
        expect(Number.isInteger(n)).toBe(true);
      }
      for (const i of o.items) expect(i.lineTotal).toBe(i.unitPrice * i.qty);
      expect(o.vat.vatRate).toBe(15);
    }
  });

  it('T-078 · order numbers are unique FX-YYYYMMDD-NNNN, status history follows the transition matrix and ends at the status', async () => {
    const orders = await prisma.order.findMany();
    expect(new Set(orders.map((o) => o.orderNo)).size).toBe(40);
    for (const o of orders) {
      expect(o.orderNo).toMatch(/^FX-\d{8}-\d{4}$/);
      expect(o.statusHistory[0]!.status).toBe('PENDING');
      expect(o.statusHistory.at(-1)!.status).toBe(o.status);
      for (let i = 1; i < o.statusHistory.length; i++) {
        expect(TRANSITIONS[o.statusHistory[i - 1]!.status]).toContain(o.statusHistory[i]!.status);
        expect(o.statusHistory[i]!.at.getTime()).toBeGreaterThanOrEqual(
          o.statusHistory[i - 1]!.at.getTime(),
        );
      }
      expect(o.paymentStatus).toBe(o.status === 'DELIVERED' ? 'PAID' : 'UNPAID');
      expect(o.paymentMethod).toBe('COD');
      expect(o.items.every((i) => i.titleSnapshot.en && i.titleSnapshot.ar && i.imageKey)).toBe(
        true,
      );
    }
  });

  it('T-078 · orders do not change product stock, so the stock invariants hold after seeding', async () => {
    const products = await prisma.product.findMany();
    expect(products.filter((p) => p.type === 'RESALE' && p.stock === 1)).toHaveLength(14);
    expect(products.filter((p) => p.stock === 0)).toHaveLength(2);
  });
});

describe('T-078 · demo reset', () => {
  it('T-078 · the dry-run plan counts what will be deleted and what is kept', async () => {
    const plan = await planReset(prisma);
    expect(plan.counts.orders).toBe(40);
    expect(plan.counts.products).toBe(32);
    expect(plan.counts['customer users']).toBe(12);
    expect(plan.counts['R2 objects (demo prefix)']).toBe(plan.demoObjectKeys.length);
    expect(plan.kept['admin users']).toBe(1);
    expect(plan.kept['site settings']).toBe(1);
    expect(plan.kept.pages).toBe(1);
  });

  it('T-078 · reset deletes demo data and demo objects only; admins, settings, pages and foreign uploads survive; re-seeding is repeatable', async () => {
    const foreignKey = `${keyPrefix()}2026/01/real-admin-upload.jpg`;
    await prisma.upload.create({
      data: {
        key: foreignKey,
        uploadedById: adminId,
        contentType: 'image/jpeg',
        size: 22,
        scope: 'admin',
        attachedAt: new Date(),
      },
    });
    s3State.objects.set(foreignKey, { ContentType: 'image/jpeg', ContentLength: 22 });
    await prisma.cart.create({ data: { userId: seeded.customers[0]!.id, items: [] } });
    await prisma.wishlist.create({
      data: { userId: seeded.customers[1]!.id, productIds: [seeded.products[0]!.id] },
    });
    await prisma.notification.create({
      data: {
        userId: seeded.customers[2]!.id,
        type: 'SYSTEM',
        title: { en: 'a', ar: 'ب' },
        body: { en: 'a', ar: 'ب' },
        link: null,
        readAt: null,
      },
    });
    const before = await prisma.counter.count();

    const demoKeys = (await planReset(prisma)).demoObjectKeys;
    expect(demoKeys.length).toBeGreaterThan(0);
    const result = await resetDemoData(prisma);
    expect(result.r2Failed).toEqual([]);
    expect(result.r2Deleted).toBe(demoKeys.length);

    for (const model of [
      'order',
      'cart',
      'wishlist',
      'notification',
      'product',
      'category',
      'banner',
      'homeSection',
      'address',
    ] as const) {
      expect(
        await (prisma[model] as unknown as { count: () => Promise<number> }).count(),
        model,
      ).toBe(0);
    }
    expect(await prisma.user.count({ where: { role: 'CUSTOMER' } })).toBe(0);
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
    expect(await prisma.siteSetting.count()).toBe(1);
    expect(await prisma.page.count()).toBe(1);
    expect(await prisma.counter.count()).toBe(before); // order numbers keep counting
    expect(await prisma.upload.count({ where: { key: foreignKey } })).toBe(1);
    expect(s3State.objects.has(foreignKey)).toBe(true);
    for (const k of demoKeys) expect(s3State.objects.has(k)).toBe(false);
    expect(await prisma.upload.count()).toBe(1); // only the foreign row is left

    await seedAll();
    expect(await prisma.product.count()).toBe(32);
    expect(await prisma.order.count()).toBe(40);
    expect(await prisma.user.count({ where: { role: 'CUSTOMER' } })).toBe(12);
  });

  it('T-078 · a demo object that cannot be deleted keeps its upload row and is reported', async () => {
    const keys = [...s3State.objects.keys()].filter((k) => k.startsWith(demoPrefix()));
    s3State.failDelete.add(keys[0]!);
    const result = await resetDemoData(prisma);
    expect(result.r2Failed).toEqual([keys[0]]);
    expect(await prisma.upload.count({ where: { key: keys[0]! } })).toBe(1);
    s3State.failDelete.clear();
    await seedAll();
  });
});

describe('T-078 · demo:reset end to end (guards pass, S3 and images mocked)', () => {
  const env = {
    NODE_ENV: 'development',
    DATABASE_URL: 'mongodb://localhost:27017/furniture_dev',
    DEMO_CUSTOMER_PASSWORD: PASSWORD,
  };
  const lines: string[] = [];
  const deps = () =>
    Promise.resolve({ prisma, imageSource: fakeImage, log: (m: string) => void lines.push(m) });

  it('T-078 · without --confirm it prints the counts, deletes nothing and exits 1', async () => {
    lines.length = 0;
    const productsBefore = await prisma.product.count();
    expect(productsBefore).toBeGreaterThan(0);
    const code = await run({ argv: [], env, deps });
    expect(code).toBe(1);
    expect(await prisma.product.count()).toBe(productsBefore);
    const out = lines.join('\n');
    expect(out).toMatch(/DELETE/);
    expect(out).toMatch(/products/);
    expect(out).toMatch(/Dry run only/);
  });

  it('T-078 · with --confirm it resets and seeds again and exits 0', async () => {
    lines.length = 0;
    const code = await run({ argv: ['--confirm'], env, deps });
    expect(code).toBe(0);
    expect(await prisma.product.count()).toBe(32);
    expect(await prisma.order.count()).toBe(40);
    expect(await prisma.category.count()).toBeGreaterThanOrEqual(8);
    expect(await prisma.user.count({ where: { role: 'ADMIN' } })).toBe(1);
  });

  it('T-078 · a failing image aborts BEFORE anything is deleted', async () => {
    const productsBefore = await prisma.product.count();
    const bad = () =>
      Promise.resolve({
        prisma,
        imageSource: async () => {
          throw new Error('download failed');
        },
        log: quiet,
      });
    const err = vi.spyOn(console, 'error').mockImplementation(quiet);
    const code = await run({ argv: ['--confirm'], env, deps: bad });
    err.mockRestore();
    expect(code).toBe(2);
    expect(await prisma.product.count()).toBe(productsBefore);
  });
});
