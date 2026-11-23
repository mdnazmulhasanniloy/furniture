// ADM-14 / ADR-009: `vat = { vatRate, applyToDelivery, pricesIncludeVat, registrationNumber? }`.
// `vatRate` is a PERCENT on the wire (15 = 15%), 0-50 with at most 2 decimals, default 0. More decimals are
// rejected (never rounded). The registration number is 15 digits, starts and ends with 3
// (api-spec VatSetting.registrationNumber `^3[0-9]{13}3$`); optional (empty = null).
export type VatSetting = {
  vatRate: number;
  applyToDelivery: boolean;
  pricesIncludeVat: boolean;
  registrationNumber?: string | null;
};

export const VAT_DEFAULTS: VatSetting = { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null };

/** The loaded value (typed unknown on SiteSettings) or the documented defaults when absent. */
export function readVat(raw: unknown): VatSetting {
  const v = (raw ?? {}) as Partial<VatSetting>;
  return {
    ...VAT_DEFAULTS,
    ...v,
    vatRate: typeof v.vatRate === "number" ? v.vatRate : 0,
    applyToDelivery: typeof v.applyToDelivery === "boolean" ? v.applyToDelivery : true,
    pricesIncludeVat: typeof v.pricesIncludeVat === "boolean" ? v.pricesIncludeVat : true,
  };
}

const RATE_RE = /^(\d{1,2})(?:\.(\d{1,2}))?$/;
export const MAX_RATE_BP = 5000;

export type RateParse = { ok: true; bp: number } | { ok: false; reason: "invalid" | "range" };

/** Percent text to basis points (integer arithmetic on the string; no floating point). */
export function parseRate(raw: string): RateParse {
  const m = RATE_RE.exec(raw.trim());
  if (!m) return { ok: false, reason: "invalid" };
  const bp = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bp > MAX_RATE_BP ? { ok: false, reason: "range" } : { ok: true, bp };
}

/** Wire percent to the text shown in the input ("15", "7.5", "0.07"). */
export function rateToText(rate: number): string {
  const bp = Math.round(rate * 100);
  const whole = Math.floor(bp / 100);
  const rest = bp % 100;
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

export const bpToRate = (bp: number): number => bp / 100;

const REG_RE = /^3[0-9]{13}3$/;
export const isRegistrationNumber = (s: string): boolean => REG_RE.test(s);

/** Integer round half up of n / d for non-negative integers (same rule as the backend, ADR-009). */
function divHalfUp(n: number, d: number): number {
  return Math.floor((2 * n + d) / (2 * d));
}

/**
 * Live example only (screen A-05: "100 SAR -> VAT x SAR"): VAT contained in / added to a 100 SAR product
 * price, using the ADR-009 formulas in halalas. The real totals are computed by the API.
 */
export function exampleVat(bp: number, pricesIncludeVat: boolean, baseHalalas = 10000): number {
  if (bp === 0) return 0;
  return pricesIncludeVat ? divHalfUp(baseHalalas * bp, 10000 + bp) : divHalfUp(baseHalalas * bp, 10000);
}
