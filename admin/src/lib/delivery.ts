import type { DeliveryCity } from "@/lib/settings";

// ADM-14: "Fees are entered in SAR and stored as halalas; negative values are rejected." The admin types
// SAR with at most 2 decimals; more decimals are rejected (never rounded), so no money rounding rule is
// needed. Conversion is string/integer arithmetic only (no floating point).
export type SarParse = { ok: true; halalas: number } | { ok: false; reason: "negative" | "invalid" };

const SAR_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

export function parseSar(raw: string): SarParse {
  const v = raw.trim();
  if (v.startsWith("-")) return { ok: false, reason: "negative" };
  const m = SAR_RE.exec(v);
  if (!m) return { ok: false, reason: "invalid" };
  return { ok: true, halalas: Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0") };
}

/** Halalas to the SAR text shown in an input ("15", "15.5" becomes "15.50"). */
export function halalasToSar(h: number): string {
  const whole = Math.floor(h / 100);
  const rest = h % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

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
