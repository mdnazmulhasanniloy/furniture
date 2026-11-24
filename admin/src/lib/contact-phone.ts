// The store's own contact number (api-spec `SaudiContactPhoneInput`; B-033, owner 2026-11-24). The API is the
// authority: this is the same rule client-side so the form can refuse a bad number before saving, and a test
// (`src/test/adm-09-settings.test.tsx`) fails if the pattern or the max length drifts from
// `backend/src/lib/phone.ts`. Mobile, landline and unified 9200/800 numbers; empty means "not published".

/** Same value as SAUDI_CONTACT_PHONE_PATTERN in backend/src/lib/phone.ts. Applies AFTER cleaning. */
export const SAUDI_CONTACT_PHONE_PATTERN = /^(\+966|00966|0)?(800\d{7}|[1-9]\d{8})$/;
export const SAUDI_CONTACT_PHONE_MAX_LENGTH = 40;

/** Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits -> ASCII 0-9. */
function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    return String(cp >= 0x06f0 ? cp - 0x06f0 : cp - 0x0660);
  });
}

/** Normalises a Saudi store contact number to `+966XXXXXXXXX`, or returns null when it is not one. */
export function normalizeSaudiContactPhone(input: string): string | null {
  if (input.length > SAUDI_CONTACT_PHONE_MAX_LENGTH) return null;
  const cleaned = toAsciiDigits(input.trim()).replace(/[\s\-.()]/g, "");
  const national = SAUDI_CONTACT_PHONE_PATTERN.exec(cleaned)?.[2];
  return national ? `+966${national}` : null;
}

/** Empty is allowed (the storefront then shows no phone line); anything else must be a Saudi number. */
export function isContactPhoneInput(value: string): boolean {
  return value.trim() === "" || normalizeSaudiContactPhone(value) !== null;
}
