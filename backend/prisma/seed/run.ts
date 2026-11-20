import argon2 from 'argon2';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CATEGORIES, DELIVERY_CITIES, DEMO_PRODUCTS, HOME_SECTIONS, PAGES } from './data.js';

export interface SeedOptions {
  nodeEnv: string;
  demo: boolean;
  admin: { email?: string; password?: string; firstName?: string; lastName?: string };
  argon2?: { memoryCost: number; timeCost: number; parallelism: number };
  log?: (msg: string) => void;
}

export interface SeedResult {
  admin: boolean;
  categories: number;
  siteSetting: boolean;
  homeSections: number;
  pages: number;
  products: number;
}

/**
 * "Create if missing" seed: it never overwrites admin-managed data, so it is safe to re-run.
 * Base part always runs; demo part (sample products) only with `demo` and never in production.
 */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions): Promise<SeedResult> {
  const log = opts.log ?? (() => undefined);
  if (opts.demo && opts.nodeEnv === 'production') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production');
  }
  const a = opts.admin;
  const missing = (['email', 'password', 'firstName', 'lastName'] as const).filter((k) => !a[k]?.trim());
  if (missing.length) {
    const names = missing.map((k) => `ADMIN_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
    throw new Error(`Missing admin seed settings: ${names.join(', ')}`);
  }
  const password = a.password as string;
  if (password.length < 12 || password.length > 128) {
    throw new Error('ADMIN_PASSWORD must be 12 to 128 characters');
  }
  const email = (a.email as string).trim().toLowerCase();

  const result: SeedResult = { admin: false, categories: 0, siteSetting: false, homeSections: 0, pages: 0, products: 0 };

  // Admin: only when the email is new. An existing user keeps its password and names.
  if (!(await prisma.user.findUnique({ where: { email } }))) {
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: opts.argon2?.memoryCost ?? 19_456,
      timeCost: opts.argon2?.timeCost ?? 2,
      parallelism: opts.argon2?.parallelism ?? 1,
    });
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: (a.firstName as string).trim(),
        lastName: (a.lastName as string).trim(),
        role: 'ADMIN',
        isVerified: true,
      },
    });
    result.admin = true;
  }

  for (const c of CATEGORIES) {
    if (await prisma.category.findUnique({ where: { slug: c.slug } })) continue;
    await prisma.category.create({ data: { slug: c.slug, name: c.name, sortOrder: c.sortOrder } });
    result.categories++;
  }

  // SiteSetting singleton: untouched when it exists (VAT, fees and cities are admin-managed).
  if (!(await prisma.siteSetting.findUnique({ where: { key: 'default' } }))) {
    await prisma.siteSetting.create({
      data: {
        key: 'default',
        storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
        contactEmail: 'info@furnixa.example',
        contactPhone: '+966500000000',
        deliveryFee: 0,
        freeDeliveryThreshold: null,
        vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true },
        currency: 'SAR',
        defaultLocale: 'ar',
        deliveryCities: DELIVERY_CITIES.map((c, i) => ({
          code: c.code,
          name: c.name,
          isActive: true,
          sortOrder: i + 1,
          deliveryFee: null,
        })),
      },
    });
    result.siteSetting = true;
  }

  // Home sections: only when the collection is empty.
  if ((await prisma.homeSection.count()) === 0) {
    await prisma.homeSection.createMany({
      data: HOME_SECTIONS.map((s, i) => ({
        type: s.type,
        title: s.title,
        config: s.config as Prisma.InputJsonValue,
        sortOrder: i + 1,
        isVisible: true,
      })),
    });
    result.homeSections = HOME_SECTIONS.length;
  }

  for (const p of PAGES) {
    if (await prisma.page.findUnique({ where: { slug: p.slug } })) continue;
    await prisma.page.create({ data: p });
    result.pages++;
  }

  if (opts.demo) {
    log('Demo seed: products are created without images (images: []). Clients must show a placeholder.');
    for (const p of DEMO_PRODUCTS) {
      if (await prisma.product.findUnique({ where: { slug: p.slug } })) continue;
      const category = await prisma.category.findUnique({ where: { slug: p.category } });
      if (!category) throw new Error(`Demo seed: category "${p.category}" not found`);
      await prisma.product.create({
        data: {
          slug: p.slug,
          title: p.title,
          description: p.description,
          type: p.type,
          condition: p.condition,
          conditionNotes:
            p.type === 'RESALE' ? { en: 'Sample pre-owned item.', ar: 'قطعة مستعملة للعرض.' } : undefined,
          price: p.price,
          stock: p.stock,
          isFeatured: p.isFeatured ?? false,
          status: 'PUBLISHED',
          categoryId: category.id,
          images: [],
        },
      });
      result.products++;
    }
  }

  log(`Seed done: ${JSON.stringify(result)}`);
  return result;
}
