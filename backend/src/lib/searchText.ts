/**
 * Arabic-aware product search (T-010, owner 2026-11-22). `Product.searchText` is recomputed on every
 * create/patch (and by the seed) from the title; the public `q` goes through the same normalisation,
 * so different alef/ta-marbuta spellings and Arabic-Indic digits still match.
 */

// Harakat and Quranic annotation marks (U+0610–061A, U+064B–065F, U+0670, U+06D6–06ED) and tatweel (U+0640).
const ARABIC_DIACRITICS = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

/** Lowercases, strips diacritics/tatweel, folds أ/إ/آ→ا, ة→ه, ى→ي, Arabic-Indic digits→ASCII, squeezes spaces. */
export function normalizeSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(ARABIC_DIACRITICS, '')
    .replace(/[أإآ]/g, 'ا') // أ إ آ -> ا
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(ARABIC_INDIC_DIGITS, (d) => {
      const code = d.charCodeAt(0);
      return String((code >= 0x06f0 ? code - 0x06f0 : code - 0x0660) % 10);
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** The stored `Product.searchText`: normalised en + ar title. Never exposed in API responses. */
export function buildSearchText(title: { en: string; ar: string }): string {
  return normalizeSearch(`${title.en} ${title.ar}`);
}

/**
 * Prisma's MongoDB `contains` passes the string into `$regex` UNESCAPED (verified by the T-010 regression
 * test: "a.b" matched "axb"), so a query must be escaped or "(" would even error. Queries only — the
 * stored `searchText` stays literal.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
