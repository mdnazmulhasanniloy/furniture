import { halalasToSar, parseSar } from "@/lib/money";
import type { DeliveryCity } from "@/lib/settings";

// ADM-14: "Fees are entered in SAR and stored as halalas; negative values are rejected." The SAR rule
// itself lives in `lib/money.ts` - since 2026-11-24 every admin money input shares it (B-031).

export const MAX_CITIES = 100;
const CODE_RE = /^[a-z0-9-]+$/;

/** Slug for a new city code from its English name; empty when the name has no latin letters or digits. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** A unique code: the slug, or slug-2, slug-3... when taken (codes compared lowercase like the API). */
export function uniqueCode(slug: string, taken: readonly string[]): string {
  if (!CODE_RE.test(slug)) return "";
  const used = new Set(taken.map((c) => c.trim().toLowerCase()));
  if (!used.has(slug)) return slug;
  for (let i = 2; ; i++) if (!used.has(`${slug}-${i}`)) return `${slug}-${i}`;
}

/** Editable city row: names and the fee override are text while editing. */
export type CityRow = { code: string; nameEn: string; nameAr: string; isActive: boolean; fee: string; orig: DeliveryCity };

export const toRows = (cities: readonly DeliveryCity[]): CityRow[] =>
  [...cities]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({
      code: c.code,
      nameEn: c.name.en,
      nameAr: c.name.ar,
      isActive: c.isActive,
      fee: c.deliveryFee == null ? "" : halalasToSar(c.deliveryFee),
      orig: c,
    }));

export type CityError = "name" | "negative" | "invalid";

/** Per-row validation: both names required, override empty (= base fee) or a valid SAR amount >= 0. */
export function cityErrors(rows: readonly CityRow[]): (CityError | null)[] {
  return rows.map((r) => {
    if (!r.nameEn.trim() || !r.nameAr.trim()) return "name";
    if (r.fee.trim() === "") return null;
    const p = parseSar(r.fee);
    return p.ok ? null : p.reason;
  });
}

export const activeCount = (rows: readonly CityRow[]) => rows.filter((r) => r.isActive).length;

/** Rows to the API shape: other fields of a loaded city are kept, sortOrder follows the row order. */
export function rowsToCities(rows: readonly CityRow[]): DeliveryCity[] {
  return rows.map((r, i) => {
    const p = r.fee.trim() === "" ? null : parseSar(r.fee);
    return {
      ...r.orig,
      code: r.code,
      name: { en: r.nameEn.trim(), ar: r.nameAr.trim() },
      isActive: r.isActive,
      sortOrder: i,
      deliveryFee: p && p.ok ? p.halalas : null,
    };
  });
}
