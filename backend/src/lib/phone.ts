import { z } from 'zod';

/** Same value as `x-canonical-pattern` of `SaudiPhoneInput` in api-spec.yaml (a test compares them). Applies AFTER normalisation. */
export const SAUDI_PHONE_PATTERN = /^(\+966|00966|0)?5[0-9]{8}$/;

/** Raw input longer than this is rejected before any normalisation (spec: maxLength 25). */
export const SAUDI_PHONE_MAX_LENGTH = 25;

/** Arabic-Indic (U+0660-0669) and Extended Arabic-Indic (U+06F0-06F9) digits -> ASCII 0-9. */
function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const cp = ch.charCodeAt(0);
    return String(cp >= 0x06f0 ? cp - 0x06f0 : cp - 0x0660);
  });
}

/**
 * Normalises a Saudi mobile number to `+9665XXXXXXXX`, or returns null when it is not one.
 * Steps (api-spec SaudiPhoneInput): length check on raw input, trim, Arabic digits -> ASCII,
 * remove spaces/dashes/dots/parentheses, strict pattern, canonical form.
 */
export function normalizeSaudiPhone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > SAUDI_PHONE_MAX_LENGTH) return null;
  const cleaned = toAsciiDigits(input.trim()).replace(/[\s\-.()]/g, '');
  if (!SAUDI_PHONE_PATTERN.test(cleaned)) return null;
  return `+9665${cleaned.slice(-8)}`;
}

/** zod schema used by profile and address (T-007): output is always `+9665XXXXXXXX`. */
export const saudiPhone = z
  .string({
    error: (issue) => (issue.input === undefined ? 'Phone is required' : 'Phone must be a string'),
  })
  .max(SAUDI_PHONE_MAX_LENGTH, 'Phone is too long')
  .transform((value, ctx) => {
    const normalized = normalizeSaudiPhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid Saudi mobile number' });
      return z.NEVER;
    }
    return normalized;
  });
