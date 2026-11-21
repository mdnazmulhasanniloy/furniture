import { AppError } from './errors.js';
import { prisma } from './prisma.js';

type SettingCities = NonNullable<
  Awaited<ReturnType<typeof prisma.siteSetting.findUnique>>
>['deliveryCities'];
export type DeliveryCity = SettingCities[number];

const normalizeCode = (code: string) => code.trim().toLowerCase();

/**
 * Normalised codes of the currently active delivery cities (one read, no cache). Same matching as `assertActiveCity`.
 */
export async function getActiveCityCodes(): Promise<Set<string>> {
  const setting = await prisma.siteSetting.findUnique({
    where: { key: 'default' },
    select: { deliveryCities: true },
  });
  return new Set(
    (setting?.deliveryCities ?? []).filter((c) => c.isActive).map((c) => normalizeCode(c.code)),
  );
}

/**
 * Returns the active delivery city for `cityCode`, or throws 422 OUT_OF_DELIVERY_AREA (ADR-008).
 * `SiteSetting.deliveryCities` is the only source and is read on every call (no cache: on Vercel a
 * per-instance cache would go stale after admin edits). Codes are compared trimmed and lowercased.
 */
export async function assertActiveCity(cityCode: unknown): Promise<DeliveryCity> {
  const wanted = typeof cityCode === 'string' ? cityCode.trim().toLowerCase() : '';
  if (wanted) {
    const setting = await prisma.siteSetting.findUnique({
      where: { key: 'default' },
      select: { deliveryCities: true },
    });
    const city = setting?.deliveryCities.find((c) => c.code.trim().toLowerCase() === wanted);
    if (city?.isActive) return city;
  }
  throw new AppError(422, 'OUT_OF_DELIVERY_AREA', 'The delivery city is unknown or not active');
}
