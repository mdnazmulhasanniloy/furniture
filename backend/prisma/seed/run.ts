import argon2 from 'argon2';
import type { Prisma, PrismaClient } from '@prisma/client';
import { buildSearchText } from '../../src/lib/searchText.js';
import { failedPasswordRules } from '../../src/lib/passwordPolicy.js';
import { CATEGORIES, DELIVERY_CITIES, DEMO_PRODUCTS, HOME_SECTIONS, PAGES } from './data.js';

export const PLACEHOLDER_CONTACT_EMAIL = 'placeholder@example.com';
export const PLACEHOLDER_CONTACT_PHONE = '+966500000000';

export interface SeedOptions {
  nodeEnv: string;
  demo: boolean;
  admin: { email?: string; password?: string; firstName?: string; lastName?: string };
  /** Optional public contact details (SEED_CONTACT_EMAIL / SEED_CONTACT_PHONE). Placeholders are used when missing. */
  contact?: { email?: string; phone?: string };
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
  const missing = (['email', 'password', 'firstName', 'lastName'] as const).filter(
    (k) => !a[k]?.trim(),
  );
  if (missing.length) {
    const names = missing.map((k) => `ADMIN_${k.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`);
    throw new Error(`Missing admin seed settings: ${names.join(', ')}`);
  }
  const password = a.password as string;
  // The same policy the API enforces (src/lib/passwordPolicy.ts): never seed an admin with a weak password.
  const weak = failedPasswordRules(password);
  if (weak.length > 0) {
    throw new Error(
      `ADMIN_PASSWORD does not meet the password policy (unmet: ${weak.join(', ')}): at least 8 characters with one uppercase letter, one lowercase letter, one digit and one special character, at most 128`,
    );
  }
  const email = (a.email as string).trim().toLowerCase();

  const result: SeedResult = {
    admin: false,
    categories: 0,
    siteSetting: false,
    homeSections: 0,
    pages: 0,
    products: 0,
  };

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
        invitedById: null, // rule 8: explicit null (T-017 audit field; the seeded admin is not invited)
      },
    });
    result.admin = true;
  }

  for (const c of CATEGORIES) {
    if (await prisma.category.findUnique({ where: { slug: c.slug } })) continue;
    // Optional fields written as explicit null (null-vs-missing, CLAUDE.md rule 8).
    await prisma.category.create({
      data: { slug: c.slug, name: c.name, sortOrder: c.sortOrder, parentId: null, image: null },
    });
    result.categories++;
  }

  // SiteSetting singleton: untouched when it exists (VAT, fees and cities are admin-managed).
  if (!(await prisma.siteSetting.findUnique({ where: { key: 'default' } }))) {
    const contactEmail = opts.contact?.email?.trim() || PLACEHOLDER_CONTACT_EMAIL;
    const contactPhone = opts.contact?.phone?.trim() || PLACEHOLDER_CONTACT_PHONE;
    if (contactEmail === PLACEHOLDER_CONTACT_EMAIL || contactPhone === PLACEHOLDER_CONTACT_PHONE) {
      log(
        'WARNING: SiteSetting contactEmail/contactPhone use placeholder values (set SEED_CONTACT_EMAIL and SEED_CONTACT_PHONE before seeding, or change them from the admin dashboard before launch).',
      );
    }
    await prisma.siteSetting.create({
      data: {
        key: 'default',
        storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
        contactEmail,
        contactPhone,
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
    log(
      'Demo seed: products are created without images (images: []). Clients must show a placeholder.',
    );
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
          // Optional fields are written as explicit null (null-vs-missing, CLAUDE.md rule 8).
          conditionNotes:
            p.type === 'RESALE'
              ? { en: 'Sample pre-owned item.', ar: 'قطعة مستعملة للعرض.' }
              : null,
          sku: null,
          compareAtPrice: null,
          dimensions: null,
          material: null,
          color: null,
          price: p.price,
          stock: p.stock,
          isFeatured: p.isFeatured ?? false,
          status: 'PUBLISHED',
          categoryId: category.id,
          images: [],
          searchText: buildSearchText(p.title), // T-010
        },
      });
      result.products++;
    }
  }

  log(`Seed done: ${JSON.stringify(result)}`);
  return result;
}
