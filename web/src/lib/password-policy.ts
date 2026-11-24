/**
 * The password policy (owner 2026-11-24). ONE definition, used by the API, the storefront and the admin.
 *
 * At least 8 characters, one uppercase letter, one lowercase letter, one digit, and one special character
 * (anything that is not a letter, a digit or a space). Reference regex from the owner:
 *   ^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s]).{8,}$
 * The 128-character ceiling is the existing API limit (PRD AUTH-03) and is part of the `length` rule.
 *
 * The three apps deploy separately (each is its own Vercel project rooted at its own folder), so they cannot
 * import one module. This file is therefore copied verbatim to web/src/lib/password-policy.ts and
 * admin/src/lib/password-policy.ts, and a test in each app fails if a copy drifts from this one.
 * Login is deliberately NOT checked against this policy: older passwords must still work.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Rule ids, in the order they are shown to the user. */
export const PASSWORD_RULES = ['length', 'upper', 'lower', 'digit', 'symbol'] as const;

export type PasswordRule = (typeof PASSWORD_RULES)[number];

const MET: Record<PasswordRule, (value: string) => boolean> = {
  length: (v) => v.length >= PASSWORD_MIN_LENGTH && v.length <= PASSWORD_MAX_LENGTH,
  upper: (v) => /[A-Z]/.test(v),
  lower: (v) => /[a-z]/.test(v),
  digit: (v) => /\d/.test(v),
  symbol: (v) => /[^A-Za-z\d\s]/.test(v),
};

/** Every rule with its state, in display order: the live checklist both apps render. */
export function passwordRuleStates(value: string): { rule: PasswordRule; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, met: MET[rule](value) }));
}

/** The rules the value does not meet, in display order. Empty means the password is allowed. */
export function failedPasswordRules(value: string): PasswordRule[] {
  return PASSWORD_RULES.filter((rule) => !MET[rule](value));
}

/** True when every rule is met. */
export function isStrongPassword(value: string): boolean {
  return failedPasswordRules(value).length === 0;
}
