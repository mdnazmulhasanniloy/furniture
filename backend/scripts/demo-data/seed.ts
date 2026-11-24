import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/lib/password.js';
import { normalizeSaudiPhone } from '../../src/lib/phone.js';
import {
  ALLOWED_CONTENT_TYPES,
  attachUploads,
  buildImageAsset,
  putObject,
  type ImageAsset,
} from '../../src/lib/r2.js';
import { buildSearchText } from '../../src/lib/searchText.js';
import {
  BANNERS,
  CATEGORIES,
  CONDITION_NOTES,
  CUSTOMERS,
  PRODUCTS,
  TESTIMONIALS,
  sar,
  type L,
} from './catalog.js';
import type { ManifestImage, ValidatedImage } from './images.js';
import { demoPrefix } from './reset.js';

const DAY_MS = 86_400_000;

export type ImageSource = (image: ManifestImage) => Promise<ValidatedImage>;

export interface SeedContext {
  adminId: string;
  manifest: ManifestImage[];
  imageSource: ImageSource;
  customerPassword: string;
  now: Date;
  log: (message: string) => void;
}

export interface SeededProduct {
  id: string;
  slug: string;
  type: 'NEW' | 'RESALE';
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR';
  status: 'DRAFT' | 'PUBLISHED';
  stock: number;
  price: number;
  title: L;
  sku: string;
  featured: boolean;
  images: ImageAsset[];
}

export interface SeededCustomer {
  id: string;
  firstName: string;
  lastName: string;
  addressId: string;
  address: {
    fullName: string;
    phone: string;
    cityCode: string;
    area: string;
    street: string;
  };
}

export interface SeedResult {
  categoryIds: string[]; // top-level, in order
  products: SeededProduct[];
  bannerIds: string[];
  customers: SeededCustomer[];
  uploads: number;
}

// ---------------------------------------------------------------- image upload (real admin-upload behaviour)

/** The pool of manifest photos for a theme; throws when the manifest lacks the theme. */
export function poolFor(manifest: ManifestImage[], theme: string): ManifestImage[] {
  const pool = manifest.filter((m) => m.theme === theme);
  if (pool.length === 0) throw new Error(`images.json has no images for theme "${theme}"`);
  return pool;
}

class Uploader {
  readonly keys: string[] = [];
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ctx: SeedContext,
  ) {}

  /**
   * One R2 object + one `Upload` row per use (like a real admin upload), then attached to the entity by the
   * caller with `attach`. Keys are `furnixa/{env}/demo/{yyyy}/{mm}/{uuid}.{ext}`.
   */
  async put(source: ManifestImage): Promise<ImageAsset> {
    const img = await this.ctx.imageSource(source);
    const ext = ALLOWED_CONTENT_TYPES[img.contentType];
    const yyyy = String(this.ctx.now.getUTCFullYear());
    const mm = String(this.ctx.now.getUTCMonth() + 1).padStart(2, '0');
    const key = `${demoPrefix()}${yyyy}/${mm}/${randomUUID()}.${ext}`;
    await putObject(key, img.bytes, img.contentType);
    await this.prisma.upload.create({
      data: {
        key,
        uploadedById: this.ctx.adminId,
        contentType: img.contentType,
        size: img.bytes.byteLength,
        scope: 'admin',
        attachedAt: null,
      },
    });
    this.keys.push(key);
    return buildImageAsset(key, { width: img.width, height: img.height, alt: source.description });
  }

  async attach(assets: ImageAsset[]): Promise<void> {
    await attachUploads(
      assets.map((a) => a.key),
      { scope: 'admin', uploadedById: this.ctx.adminId },
    );
  }
}

// ---------------------------------------------------------------- catalog

export async function seedDemoData(prisma: PrismaClient, ctx: SeedContext): Promise<SeedResult> {
  const up = new Uploader(prisma, ctx);

  // ---- categories (8 top-level, one level of children where natural)
  const topIds: string[] = [];
  const catIdBySlug = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const image = await up.put(poolFor(ctx.manifest, c.theme)[0]!);
    const row = await prisma.category.create({
      data: { name: c.name, slug: c.slug, image, parentId: null, sortOrder: i + 1, isActive: true },
    });
    await up.attach([image]);
    topIds.push(row.id);
    catIdBySlug.set(c.slug, row.id);
    for (const [j, child] of (c.children ?? []).entries()) {
      const childRow = await prisma.category.create({
        data: {
          name: child.name,
          slug: child.slug,
          image: null,
          parentId: row.id,
          sortOrder: j + 1,
          isActive: true,
        },
      });
      catIdBySlug.set(child.slug, childRow.id);
    }
  }
  ctx.log(`categories: ${catIdBySlug.size}`);

  // ---- products (4 per top-level category: NEW, NEW, RESALE, RESALE)
  const products: SeededProduct[] = [];
  const resaleConditions = ['LIKE_NEW', 'GOOD', 'FAIR'] as const;
  let resaleCounter = 0;
  for (const [idx, p] of PRODUCTS.entries()) {
    const cat = CATEGORIES.find((c) => c.slug === p.category)!;
    const posInCategory = PRODUCTS.filter((x) => x.category === p.category).indexOf(p);
    const type = posInCategory < 2 ? 'NEW' : 'RESALE';
    const condition = type === 'NEW' ? 'NEW' : resaleConditions[resaleCounter++ % 3]!;
    const stock = p.soldOut ? 0 : type === 'RESALE' ? 1 : 3 + ((idx * 7) % 18); // new: 3..20
    const pool = poolFor(ctx.manifest, cat.theme);
    const imageCount = 2 + (idx % 3); // 2..4
    const images: ImageAsset[] = [];
    for (let k = 0; k < imageCount; k++) {
      images.push(await up.put(pool[(posInCategory + k) % pool.length]!));
    }
    const status = p.draft ? 'DRAFT' : 'PUBLISHED';
    const row = await prisma.product.create({
      data: {
        title: p.title,
        description: p.description,
        slug: p.slug,
        sku: p.sku,
        type,
        condition,
        conditionNotes: type === 'RESALE' ? CONDITION_NOTES[condition as 'LIKE_NEW'] : null,
        price: sar(p.priceSar),
        compareAtPrice: p.wasSar ? sar(p.wasSar) : null,
        stock,
        categoryId: catIdBySlug.get(p.sub ?? p.category)!,
        images,
        dimensions: {
          widthCm: p.dims[0],
          depthCm: p.dims[1],
          heightCm: p.dims[2],
          weightKg: p.dims[3],
        },
        material: p.material,
        color: p.color,
        isFeatured: posInCategory === 0, // 8 featured, one per category
        status,
        searchText: buildSearchText(p.title),
        createdAt: new Date(ctx.now.getTime() - (PRODUCTS.length - idx) * 1.5 * DAY_MS),
      },
    });
    await up.attach(images);
    products.push({
      id: row.id,
      slug: p.slug,
      type,
      condition,
      status,
      stock,
      price: row.price,
      title: p.title,
      sku: p.sku,
      featured: posInCategory === 0,
      images,
    });
  }
  ctx.log(`products: ${products.length}`);

  // ---- banners (3, one scheduled for the future)
  const bannerIds: string[] = [];
  for (const [i, b] of BANNERS.entries()) {
    const desktop = await up.put(poolFor(ctx.manifest, b.desktopTheme)[i % 3]!);
    const mobile = await up.put(poolFor(ctx.manifest, b.mobileTheme)[i % 3]!);
    const row = await prisma.banner.create({
      data: {
        title: b.title,
        subtitle: b.subtitle,
        ctaLabel: b.ctaLabel,
        ctaHref: b.ctaHref,
        imageDesktop: desktop,
        imageMobile: mobile,
        startsAt:
          b.startsInDays === null ? null : new Date(ctx.now.getTime() + b.startsInDays * DAY_MS),
        endsAt: null,
        sortOrder: i + 1,
        isActive: true,
      },
    });
    await up.attach([desktop, mobile]);
    bannerIds.push(row.id);
  }
  ctx.log(`banners: ${bannerIds.length}`);

  // ---- shop the look (CR-009, ADM-15): one room photo, three hotspots on seeded products
  const lookSource = ctx.manifest.find((m) => m.id === 'sofas-5');
  if (!lookSource) throw new Error('images.json has no "sofas-5" image for the look');
  const lookImage = await up.put(lookSource);
  const lookProduct = (slug: string): string => {
    const p = products.find((x) => x.slug === slug);
    if (!p) throw new Error(`Seeded product "${slug}" not found for the look`);
    return p.id;
  };
  const lookConfig = {
    look: {
      image: lookImage,
      // positions measured on the photo: the armchair (left), the floor lamp (centre), the sofa (right)
      hotspots: [
        { x: 18, y: 70, productId: lookProduct('leather-club-armchair-pre-owned') },
        { x: 59, y: 50, productId: lookProduct('aurora-floor-lamp') },
        { x: 80, y: 72, productId: lookProduct('riviera-three-seater-sofa') },
      ],
    },
  };

  // ---- home sections
  const sections: Prisma.HomeSectionCreateInput[] = [
    {
      type: 'FEATURED_PRODUCTS',
      title: { en: 'Featured pieces', ar: 'قطع مميزة' },
      subtitle: { en: 'Hand-picked by our team', ar: 'مختارة بعناية من فريقنا' },
      config: { productIds: products.filter((p) => p.featured).map((p) => p.id) },
    },
    {
      type: 'NEW_ARRIVALS',
      title: { en: 'New arrivals', ar: 'وصل حديثاً' },
      subtitle: null,
      config: { limit: 8 },
    },
    {
      type: 'CATEGORY_GRID',
      title: { en: 'Shop by room', ar: 'تسوق حسب الغرفة' },
      subtitle: null,
      config: { categoryIds: topIds },
    },
    {
      type: 'SHOP_THE_LOOK',
      title: { en: 'Shop the look', ar: 'تسوّق هذا التنسيق' },
      subtitle: {
        en: 'Tap the dots to see what is in the room.',
        ar: 'اضغط على النقاط لترى ما في الغرفة.',
      },
      config: lookConfig,
    },
    {
      type: 'RESALE_PICKS',
      title: { en: 'Pre-owned picks', ar: 'مختارات مستعملة' },
      subtitle: {
        en: 'Graded, with photos and condition notes',
        ar: 'مصنّفة مع صور وملاحظات الحالة',
      },
      config: { limit: 8 },
    },
    {
      type: 'PROMO_BANNER',
      title: { en: 'Pre-owned, for less', ar: 'مستعمل بسعر أقل' },
      subtitle: null,
      config: { bannerId: bannerIds[1]! },
    },
    {
      type: 'TESTIMONIALS',
      title: { en: 'What customers say (demo)', ar: 'آراء العملاء (تجريبي)' },
      subtitle: null,
      config: { testimonials: TESTIMONIALS },
    },
  ].map((s, i) => ({ ...s, sortOrder: i + 1, isVisible: true })) as Prisma.HomeSectionCreateInput[];
  for (const s of sections) await prisma.homeSection.create({ data: s });
  await up.attach([lookImage]); // the look photo is attached to its section like a banner image
  ctx.log(`home sections: ${sections.length}`);

  // ---- customers (12, verified, one default address each in an active seeded city)
  const settings = await prisma.siteSetting.findUnique({ where: { key: 'default' } });
  const cities = settings?.deliveryCities.filter((c) => c.isActive) ?? [];
  if (cities.length === 0) throw new Error('No active delivery cities: run "npm run seed" first.');
  const customers: SeededCustomer[] = [];
  for (const [i, c] of CUSTOMERS.entries()) {
    const city = cities[i % cities.length]!;
    const phone = normalizeSaudiPhone(`5${String(10_000_000 + i * 1_234_567).slice(0, 8)}`);
    if (!phone) throw new Error(`Generated an invalid phone for ${c.email}`);
    const user = await prisma.user.create({
      data: {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        passwordHash: await hashPassword(ctx.customerPassword),
        role: 'CUSTOMER',
        isVerified: true,
        isBlocked: false,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: null,
        phone,
        avatar: null,
        preferredLocale: c.locale,
        invitedById: null,
        createdAt: new Date(ctx.now.getTime() - (40 + i) * DAY_MS),
      },
    });
    const fullName = `${c.firstName} ${c.lastName}`;
    const address = await prisma.address.create({
      data: {
        userId: user.id,
        label: 'Home',
        fullName,
        phone,
        cityCode: city.code,
        area: c.area,
        street: c.street,
        notes: null,
        isDefault: true,
      },
    });
    customers.push({
      id: user.id,
      firstName: c.firstName,
      lastName: c.lastName,
      addressId: address.id,
      address: { fullName, phone, cityCode: city.code, area: c.area, street: c.street },
    });
  }
  ctx.log(`customers: ${customers.length}`);

  return { categoryIds: topIds, products, bannerIds, customers, uploads: up.keys.length };
}
