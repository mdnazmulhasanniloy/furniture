// The one money rule for every admin input (owner 2026-11-24, closes B-031; was ADM-14 only):
// admins type SAR with at most 2 decimals, the UI converts to integer halalas and displays SAR, and the
// API keeps taking halalas. Conversion is string/integer arithmetic only - no floating point, so 0.01
// and 1250.50 are exact. More than 2 decimals is rejected, never rounded, so no rounding rule is needed.
// Accepted shapes: "150", "150.5", "150.50", "0.01", "1,250.50", Arabic-Indic digits ("١٥٠٫٥٠"),
// surrounding spaces. Rejected: negatives, "abc", "", "1.005", amounts over MAX_PRICE_HALALAS.

export type SarParse = { ok: true; halalas: number } | { ok: false; reason: "negative" | "invalid" };

/** api-spec ProductInput: price / compareAtPrice are 0..100000000 halalas (1,000,000 SAR). */
export const MAX_PRICE_HALALAS = 100_000_000;

const SAR_RE = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/** Arabic-Indic (U+0660..) and Extended Arabic-Indic (U+06F0..) digits to ASCII. */
const toAsciiDigits = (s: string) =>
  s.replace(/[٠-٩۰-۹]/g, (d) => String(d.codePointAt(0)! & 0xf));

/** Digits to ASCII, the Arabic decimal mark to ".", and group separators and spaces removed. */
const normalize = (raw: string) =>
  toAsciiDigits(raw)
    .trim()
    .replace(/٫/g, ".")
    .replace(/[,٬\s  ]/g, "");

export function parseSar(raw: string): SarParse {
  const v = normalize(raw);
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

/**
 * Halalas of an amount the schema has already accepted. The throw can only fire if a form sends an
 * unvalidated string, which would otherwise reach the API as NaN.
 */
export function sarHalalas(raw: string): number {
  const p = parseSar(raw);
  if (!p.ok) throw new Error(`not a valid SAR amount: ${raw}`);
  return p.halalas;
}
