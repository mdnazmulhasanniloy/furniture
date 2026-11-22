import { Prisma, type SiteSetting } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { buildImageAsset, syncImages, type R2Context } from '../../lib/r2.js';
import type { PutSettingsBody } from './schema.js';

const SETTINGS_KEY = 'default';
const notFound = () =>
  new AppError(404, 'NOT_FOUND', 'Site settings not found (run the seed first)');
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

export type SaveContext = R2Context & { uploadedById: string };
const noRelease = async () => {};

const toSettings = (s: SiteSetting, opts: { activeCitiesOnly: boolean }) => ({
  storeName: s.storeName,
  logo: s.logo ?? null,
  contactEmail: s.contactEmail,
  contactPhone: s.contactPhone,
  address: s.address ?? null,
  socials: s.socials ?? null,
  deliveryFee: s.deliveryFee,
  freeDeliveryThreshold: s.freeDeliveryThreshold ?? null,
  vat: {
    vatRate: s.vat.vatRate,
    applyToDelivery: s.vat.applyToDelivery,
    pricesIncludeVat: s.vat.pricesIncludeVat,
    registrationNumber: s.vat.registrationNumber ?? null,
  },
  currency: s.currency,
  deliveryCities: s.deliveryCities
    .filter((c) => !opts.activeCitiesOnly || c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      code: c.code,
      name: c.name,
      isActive: c.isActive,
      sortOrder: c.sortOrder,
      deliveryFee: c.deliveryFee ?? null,
    })),
  defaultLocale: s.defaultLocale,
  seo: s.seo ?? null,
  updatedAt: s.updatedAt,
});
export type SettingsResponse = ReturnType<typeof toSettings>;

const staleUpdate = (current: SiteSetting) =>
  new AppError(409, 'STALE_UPDATE', 'Settings were changed by someone else; reload and retry', {
    current: toSettings(current, { activeCitiesOnly: false }),
  });

async function load(): Promise<SiteSetting> {
  const row = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) throw notFound();
  return row;
}

/** ADM-09 public view: active cities only (ADM-13). */
export async function getPublic(): Promise<SettingsResponse> {
  return toSettings(await load(), { activeCitiesOnly: true });
}

export async function getAdmin(): Promise<SettingsResponse> {
  return toSettings(await load(), { activeCitiesOnly: false });
}

/** MongoDB Json fields take plain null (no DbNull/JsonNull split on this connector). */
const jsonOrNull = (v: unknown): Prisma.InputJsonValue | null =>
  v === undefined || v === null ? null : (v as Prisma.InputJsonValue);

/**
 * Full replace (owner 2026-11-22): absent optional fields are cleared. Shape validation only — the
 * city immutability and last-active-city rules are T-022.
 */
export async function update(
  body: PutSettingsBody,
  ctx: SaveContext,
): Promise<{ settings: SettingsResponse; release: () => Promise<void> }> {
  const logo = body.logo ? buildImageAsset(body.logo.key, { alt: body.logo.alt }) : null;
  let release = noRelease;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
      if (!current) throw notFound();
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      const sync = await syncImages(
        tx,
        current.logo ? [current.logo.key] : [],
        logo ? [logo.key] : [],
        'admin',
        ctx,
      );
      release = sync.release;

      // One conditional write: nothing matches when someone saved in between -> 409, nothing changed.
      const res = await tx.siteSetting.updateMany({
        where: { key: SETTINGS_KEY, updatedAt: body.expectedUpdatedAt },
        data: {
          storeName: body.storeName,
          logo,
          contactEmail: body.contactEmail,
          contactPhone: body.contactPhone,
          address: body.address ?? null,
          socials: jsonOrNull(body.socials),
          deliveryFee: body.deliveryFee,
          freeDeliveryThreshold: body.freeDeliveryThreshold ?? null,
          vat: {
            vatRate: body.vat.vatRate,
            applyToDelivery: body.vat.applyToDelivery,
            pricesIncludeVat: body.vat.pricesIncludeVat,
            registrationNumber: body.vat.registrationNumber ?? null,
          },
          deliveryCities: body.deliveryCities.map((c) => ({
            code: c.code,
            name: c.name,
            isActive: c.isActive,
            sortOrder: c.sortOrder,
            deliveryFee: c.deliveryFee ?? null,
          })),
          defaultLocale: body.defaultLocale,
          seo: jsonOrNull(body.seo),
        },
      });
      if (res.count !== 1) throw staleUpdate(current);
      return tx.siteSetting.findUniqueOrThrow({ where: { key: SETTINGS_KEY } });
    });
    return { settings: toSettings(row, { activeCitiesOnly: false }), release };
  } catch (err) {
    // The transaction rolled back: the caller never gets (and never calls) release.
    if (isWriteConflict(err)) {
      const current = await prisma.siteSetting.findUnique({ where: { key: SETTINGS_KEY } });
      throw current ? staleUpdate(current) : notFound();
    }
    throw err;
  }
}
