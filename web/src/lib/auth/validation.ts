// Client-side mirrors of the API rules (api-spec.yaml). The server stays the authority.

import { isStrongPassword } from "@/lib/password-policy";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FieldError = "required" | "emailInvalid" | "passwordWeak" | "codeIncomplete";

export function validateRequired(v: string, max = 40): FieldError | null {
  const t = v.trim();
  return t.length < 1 || t.length > max ? "required" : null;
}

export function validateEmail(v: string): FieldError | null {
  const t = v.trim();
  if (!t) return "required";
  return EMAIL_RE.test(t) ? null : "emailInvalid";
}

/** The one password policy (src/lib/password-policy.ts, owner 2026-11-24); the live checklist shows which rule is unmet. */
export function validateNewPassword(v: string): FieldError | null {
  if (!v) return "required";
  return isStrongPassword(v) ? null : "passwordWeak";
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
const EXT_ARABIC_INDIC = "۰۱۲۳۴۵۶۷۸۹";

/** Keep only digits, mapping Arabic-Indic digits (typed on an Arabic keyboard) to ASCII. */
export function digitsOnly(v: string): string {
  return Array.from(v)
    .map((c) => {
      const a = ARABIC_INDIC.indexOf(c);
      if (a >= 0) return String(a);
      const b = EXT_ARABIC_INDIC.indexOf(c);
      return b >= 0 ? String(b) : c;
    })
    .join("")
    .replace(/\D/g, "");
}
