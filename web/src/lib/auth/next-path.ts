import { routing } from "@/i18n/routing";

/**
 * QA B2 (2026-11-24): the `next` path an auth page may send the visitor to after signing in. Only a
 * path on this site is accepted - never an absolute URL, a protocol-relative "//host", a scheme like
 * `javascript:`, or anything with a backslash or a control character (browsers strip those inside a
 * URL, so "/\host" would become "//host"). A leading locale segment is removed, because the localized
 * router adds the current one itself.
 */
export function safeNext(raw: string | null | undefined, locale: string): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  // The visitor's own locale first; a path that still carries another locale's prefix loses it too,
  // so the router cannot end up with two prefixes.
  const prefixes = [locale, ...routing.locales.filter((l) => l !== locale)];
  for (const l of prefixes) {
    if (value === `/${l}`) return "/";
    if (value.startsWith(`/${l}/`)) return value.slice(l.length + 1);
  }
  return value;
}

/** Where an already signed-in visitor goes from /login or /register. */
export const accountTarget = (raw: string | null | undefined, locale: string): string =>
  safeNext(raw, locale) ?? "/account";
