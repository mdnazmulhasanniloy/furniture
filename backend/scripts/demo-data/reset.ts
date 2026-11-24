import type { PrismaClient } from '@prisma/client';
import { deleteObjects, keyPrefix, listKeys } from '../../src/lib/r2.js';
import { escapeRegex } from '../../src/lib/searchText.js';

/** Every demo R2 object lives under this prefix, e.g. `furnixa/development/demo/`. The reset never leaves it. */
export const demoPrefix = (): string => `${keyPrefix()}demo/`;

export interface ResetPlan {
  counts: Record<string, number>;
  /** R2 objects under the demo prefix (will be deleted). */
  demoObjectKeys: string[];
  /** Image keys still referenced by data being deleted that are NOT under the demo prefix: left untouched. */
  foreignImageKeys: string[];
  /** Collections that are kept. */
  kept: Record<string, number>;
}

const isDemoKey = (k: string) => k.startsWith(demoPrefix());

/** Read-only: counts what a reset would delete. */
export async function planReset(prisma: PrismaClient): Promise<ResetPlan> {
  const customerWhere = { role: 'CUSTOMER' as const };
  // escapeRegex: Prisma MongoDB passes startsWith to $regex unescaped (CLAUDE.md rule 9)
  const demoUploadWhere = { key: { startsWith: escapeRegex(demoPrefix()) } };
  const [
    orders,
    carts,
    wishlists,
    notifications,
    addresses,
    customers,
    products,
    categories,
    banners,
    homeSections,
    demoUploads,
    admins,
    pages,
    siteSettings,
  ] = await Promise.all([
    prisma.order.count(),
    prisma.cart.count(),
    prisma.wishlist.count(),
    prisma.notification.count(),
    prisma.address.count(),
    prisma.user.count({ where: customerWhere }),
    prisma.product.count(),
    prisma.category.count(),
    prisma.banner.count(),
    prisma.homeSection.count(),
    prisma.upload.count({ where: demoUploadWhere }),
    prisma.user.count({ where: { role: 'ADMIN' } }),
    prisma.page.count(),
    prisma.siteSetting.count(),
  ]);
  const demoObjectKeys = await listKeys(demoPrefix());
  return {
    counts: {
      orders,
      carts,
      wishlists,
      notifications,
      addresses,
      'customer users': customers,
      products,
      categories,
      banners,
      'home sections': homeSections,
      'upload rows (demo prefix)': demoUploads,
      'R2 objects (demo prefix)': demoObjectKeys.length,
    },
    demoObjectKeys,
    foreignImageKeys: await foreignImageKeys(prisma),
    kept: { 'admin users': admins, pages, 'site settings': siteSettings },
  };
}

async function foreignImageKeys(prisma: PrismaClient): Promise<string[]> {
  const [products, categories, banners] = await Promise.all([
    prisma.product.findMany({ select: { images: true } }),
    prisma.category.findMany({ select: { image: true } }),
    prisma.banner.findMany({ select: { imageDesktop: true, imageMobile: true } }),
  ]);
  const keys = new Set<string>();
  for (const p of products) for (const i of p.images) keys.add(i.key);
  for (const c of categories) if (c.image) keys.add(c.image.key);
  for (const b of banners) {
    keys.add(b.imageDesktop.key);
    if (b.imageMobile) keys.add(b.imageMobile.key);
  }
  return [...keys].filter((k) => !isDemoKey(k)).sort();
}

export interface ResetResult {
  deleted: Record<string, number>;
  r2Deleted: number;
  r2Failed: string[];
}

/**
 * Deletes in dependency order. R2 objects go first; an upload row whose object could not be deleted is kept
 * (so nothing is orphaned silently) and reported.
 */
export async function resetDemoData(prisma: PrismaClient): Promise<ResetResult> {
  const deleted: Record<string, number> = {};
  const del = async (name: string, p: Promise<{ count: number }>) => {
    deleted[name] = (await p).count;
  };

  await del('orders', prisma.order.deleteMany());
  await del('carts', prisma.cart.deleteMany());
  await del('wishlists', prisma.wishlist.deleteMany());
  await del('notifications', prisma.notification.deleteMany());

  // Demo-prefix R2 objects (listing is authoritative: it also catches objects that have no Upload row).
  const keys = await listKeys(demoPrefix());
  const { deleted: okKeys, failed } = await deleteObjects(keys);
  const demoRows = await prisma.upload.findMany({
    where: { key: { startsWith: escapeRegex(demoPrefix()) } },
    select: { key: true },
  });
  const failedSet = new Set(failed);
  const removable = demoRows.map((r) => r.key).filter((k) => !failedSet.has(k));
  deleted['upload rows (demo prefix)'] = (
    await prisma.upload.deleteMany({ where: { key: { in: removable } } })
  ).count;

  await del('products', prisma.product.deleteMany());
  await del('banners', prisma.banner.deleteMany());
  await del('home sections', prisma.homeSection.deleteMany());
  // Categories: children before parents (onDelete NoAction on the self relation).
  const all = await prisma.category.findMany({ select: { id: true, parentId: true } });
  const childIds = all.filter((c) => c.parentId).map((c) => c.id);
  const first = await prisma.category.deleteMany({ where: { id: { in: childIds } } });
  const second = await prisma.category.deleteMany();
  deleted.categories = first.count + second.count;

  await del(
    'addresses (customers)',
    prisma.address.deleteMany({ where: { user: { role: 'CUSTOMER' } } }),
  );
  await del(
    'refresh tokens (customers)',
    prisma.refreshToken.deleteMany({ where: { user: { role: 'CUSTOMER' } } }),
  );
  await del('customer users', prisma.user.deleteMany({ where: { role: 'CUSTOMER' } }));

  return { deleted, r2Deleted: okKeys.length, r2Failed: failed };
}
