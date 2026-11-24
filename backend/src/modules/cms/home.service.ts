import type { Banner, Category, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notSet } from '../../lib/prismaFilters.js';
import { toCategory } from '../categories/service.js';
import { toProduct } from '../products/service.js';
import { toBanner, type BannerResponse } from './banners.service.js';
import { toSection, type SectionResponse } from './sections.service.js';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

/** The config was validated on write (schema.ts), but tolerate anything: the home page must never 500. */
interface SectionConfig {
  productIds?: unknown;
  categoryIds?: unknown;
  limit?: unknown;
  bannerId?: unknown;
  testimonials?: unknown;
  look?: unknown;
}

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const limitOf = (v: unknown): number =>
  typeof v === 'number' && Number.isInteger(v)
    ? Math.min(Math.max(v, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

/**
 * ADM-06: active and inside the schedule. `notSet` matches a missing OR null bound (rule 8: a
 * `{ startsAt: null }` where-filter alone would skip documents stored without the field).
 */
const scheduledNow = (now: Date): Prisma.BannerWhereInput => ({
  isActive: true,
  AND: [
    { OR: [notSet<Prisma.BannerWhereInput>('startsAt'), { startsAt: { lte: now } }] },
    { OR: [notSet<Prisma.BannerWhereInput>('endsAt'), { endsAt: { gt: now } }] },
  ],
});

async function resolveProducts(
  where: Prisma.ProductWhereInput,
  limit: number,
): Promise<ReturnType<typeof toProduct>[]> {
  const rows = await prisma.product.findMany({
    where: { ...where, status: 'PUBLISHED' },
    include: { category: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
  return rows.map(toProduct);
}

/** PUBLISHED only, in the order the admin listed them (owner 2026-11-22). */
async function resolveProductsByIds(
  ids: string[],
  limit: number,
): Promise<ReturnType<typeof toProduct>[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.product.findMany({
    where: { id: { in: ids }, status: 'PUBLISHED' },
    include: { category: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r) => r !== undefined)
    .slice(0, limit)
    .map(toProduct);
}

/** CR-011 T-092: PUBLISHED products per category, counting direct sub-categories like the shop filter does. */
async function withProductCounts(
  picked: Category[],
  all: Category[],
): Promise<(ReturnType<typeof toCategory> & { productCount: number })[]> {
  const ids = [
    ...new Set(
      picked.flatMap((c) => [c.id, ...all.filter((x) => x.parentId === c.id).map((x) => x.id)]),
    ),
  ];
  const rows = ids.length
    ? await prisma.product.groupBy({
        by: ['categoryId'],
        where: { status: 'PUBLISHED', categoryId: { in: ids } },
        _count: { _all: true },
      })
    : [];
  const countBy = new Map(rows.map((r) => [r.categoryId, r._count._all]));
  return picked.map((c) => {
    const own = [c.id, ...all.filter((x) => x.parentId === c.id).map((x) => x.id)];
    return { ...toCategory(c), productCount: own.reduce((n, id) => n + (countBy.get(id) ?? 0), 0) };
  });
}

type ResolvedSection = SectionResponse & {
  products?: ReturnType<typeof toProduct>[];
  categories?: (ReturnType<typeof toCategory> & { productCount: number })[];
  banner?: BannerResponse;
  look?: {
    image: unknown;
    hotspots: { x: number; y: number; product: ReturnType<typeof toProduct> }[];
  };
};

/**
 * SHOP_THE_LOOK (ADM-15): each hotspot gets its PUBLISHED product; a hotspot whose product is unpublished
 * or deleted is dropped; with no photo or no hotspot left the property is omitted and the storefront skips
 * the section. Tolerates any stored shape (the home page must never 500).
 */
async function resolveLook(config: SectionConfig): Promise<ResolvedSection['look'] | undefined> {
  const look = config.look as { image?: unknown; hotspots?: unknown } | undefined;
  const raw = Array.isArray(look?.hotspots) ? (look.hotspots as unknown[]) : [];
  const spots = raw
    .map((h) => h as { x?: unknown; y?: unknown; productId?: unknown })
    .filter(
      (h): h is { x: number; y: number; productId: string } =>
        typeof h.x === 'number' && typeof h.y === 'number' && typeof h.productId === 'string',
    );
  if (!look?.image || spots.length === 0) return undefined;
  const products = await resolveProductsByIds(
    [...new Set(spots.map((h) => h.productId))],
    spots.length,
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  const hotspots = spots.flatMap((h) => {
    const product = byId.get(h.productId);
    return product ? [{ x: h.x, y: h.y, product }] : [];
  });
  return hotspots.length > 0 ? { image: look.image, hotspots } : undefined;
}

async function resolveSection(
  section: SectionResponse,
  activeBanners: Banner[],
): Promise<ResolvedSection> {
  const cfg = (section.config ?? {}) as SectionConfig;
  const limit = limitOf(cfg.limit);
  switch (section.type) {
    case 'FEATURED_PRODUCTS': {
      const ids = idList(cfg.productIds);
      const products = ids.length
        ? await resolveProductsByIds(ids, limit)
        : await resolveProducts({ isFeatured: true }, limit);
      return { ...section, products };
    }
    case 'NEW_ARRIVALS':
      return { ...section, products: await resolveProducts({}, limit) };
    case 'RESALE_PICKS':
      return { ...section, products: await resolveProducts({ type: 'RESALE' }, limit) };
    case 'CATEGORY_GRID': {
      const active = await prisma.category.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      });
      const ids = idList(cfg.categoryIds);
      if (ids.length) {
        const byId = new Map(active.map((c) => [c.id, c]));
        const picked = ids.map((id) => byId.get(id)).filter((c) => c !== undefined);
        return { ...section, categories: await withProductCounts(picked, active) };
      }
      // Roots are found in memory: a `{ parentId: null }` where-filter would miss documents created
      // without the field (null-vs-missing, CLAUDE.md rule 8; seeded categories carry explicit null,
      // but older imports may not).
      return {
        ...section,
        categories: await withProductCounts(
          active.filter((c) => !c.parentId),
          active,
        ),
      };
    }
    case 'PROMO_BANNER': {
      const banner = activeBanners.find((b) => b.id === cfg.bannerId);
      // Missing, inactive or out-of-schedule banner: the property is omitted, the storefront skips it.
      return banner ? { ...section, banner: toBanner(banner) } : { ...section };
    }
    case 'TESTIMONIALS':
      return { ...section }; // config.testimonials is the payload, already on the section
    case 'SHOP_THE_LOOK': {
      const look = await resolveLook(cfg);
      return look ? { ...section, look } : { ...section };
    }
    default:
      return { ...section };
  }
}

/** GET /cms/home (ADM-06, ADM-07): active scheduled banners + visible sections with resolved data. */
export async function getHome(now = new Date()): Promise<{
  banners: BannerResponse[];
  sections: ResolvedSection[];
}> {
  const [bannerRows, sectionRows] = await Promise.all([
    prisma.banner.findMany({
      where: scheduledNow(now),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.homeSection.findMany({
      where: { isVisible: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);
  const sections = await Promise.all(
    sectionRows.map((row) => resolveSection(toSection(row), bannerRows)),
  );
  return { banners: bannerRows.map(toBanner), sections };
}
