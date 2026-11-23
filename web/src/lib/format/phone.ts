// Mirrors backend/src/lib/phone.ts (ADR-008, api-spec SaudiPhoneInput).
// Same normalisation, then the x-canonical-pattern.
export const SAUDI_PHONE_PATTERN = /^(\+966|00966|0)?5[0-9]{8}$/;
export const SAUDI_PHONE_MAX_LENGTH = 25;

function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    return String(cp >= 0x06f0 ? cp - 0x06f0 : cp - 0x0660);
  });
}

/** Returns `+9665XXXXXXXX`, or null when the input is not a Saudi mobile number. */
export function normalizeSaudiPhone(input: unknown): string | null {
  if (typeof input !== "string" || input.length > SAUDI_PHONE_MAX_LENGTH) return null;
  const cleaned = toAsciiDigits(input.trim()).replace(/[\s\-.()]/g, "");
  if (!SAUDI_PHONE_PATTERN.test(cleaned)) return null;
  return `+9665${cleaned.slice(-8)}`;
}

export function isValidSaudiPhone(input: unknown): boolean {
  return normalizeSaudiPhone(input) !== null;
}

/** `+966 5X XXX XXXX` (render inside an element with dir="ltr"). */
export function formatSaudiPhone(input: string): string {
  const n = normalizeSaudiPhone(input);
  if (!n) return input;
  return `+966 ${n.slice(4, 6)} ${n.slice(6, 9)} ${n.slice(9)}`;
}
