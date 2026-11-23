// Client-side mirrors of the API rules (api-spec.yaml). The server stays the authority.

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

/** 8-128 characters, at least one letter and one number. */
export function validateNewPassword(v: string): FieldError | null {
  if (!v) return "required";
  return v.length >= 8 && v.length <= 128 && /\p{L}/u.test(v) && /\p{N}/u.test(v)
    ? null
    : "passwordWeak";
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
