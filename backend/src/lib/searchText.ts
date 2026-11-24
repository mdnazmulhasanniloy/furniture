import type { Prisma } from '@prisma/client';

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

/** "sofas" -> "sofa", "benches" -> "bench", "chairs" -> "chair". Latin only, words of 4+ letters; Arabic is left alone. */
export function stem(word: string): string {
  if (!/^[a-z]{4,}$/.test(word)) return word;
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('ss') || !word.endsWith('s')) return word;
  return word.slice(0, -1);
}

/**
 * Public product search (QA 2026-11-24): every word of the query must be found (AND), a word may be found in its
 * plural/singular form (OR), and in the title text, the description, the category name or the material, in both
 * languages. All strings are regex-escaped (Prisma passes `contains` to $regex unescaped on MongoDB).
 */
export function searchWhere(q: string): Prisma.ProductWhereInput {
  const words = normalizeSearch(q).split(' ').filter(Boolean);
  return {
    AND: words.map((word) => {
      const variants = [...new Set([word, stem(word)])].map(escapeRegex);
      const hit = { mode: 'insensitive' as const };
      return {
        OR: variants.flatMap((v) => [
          { searchText: { contains: v, ...hit } },
          { description: { is: { en: { contains: v, ...hit } } } },
          { description: { is: { ar: { contains: v, ...hit } } } },
          { category: { is: { name: { is: { en: { contains: v, ...hit } } } } } },
          { category: { is: { name: { is: { ar: { contains: v, ...hit } } } } } },
          { material: { contains: v, ...hit } },
        ]),
      };
    }),
  };
}
