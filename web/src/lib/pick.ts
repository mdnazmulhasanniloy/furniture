import type { Locale } from "@/i18n/routing";

export type LocalizedText = { en?: string | null; ar?: string | null };

/** Localized API field: the active locale, falling back to `en` (web/CLAUDE.md rule 4). */
export function pick(field: LocalizedText | null | undefined, locale: string): string {
  if (!field) return "";
  const value = field[locale as Locale];
  return value && value.trim() ? value : (field.en ?? "");
}
