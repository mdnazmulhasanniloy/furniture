import { describe, expect, it } from 'vitest';
import {
  buildSearchText,
  escapeRegex,
  MAX_SEARCH_WORDS,
  normalizeSearch,
  searchTerms,
  searchWhere,
} from '../../src/lib/searchText.js';

describe('PROD-01 · Arabic-aware search normalisation (owner 2026-11-22)', () => {
  it('PROD-01 · lowercases and squeezes whitespace', () => {
    expect(normalizeSearch('  Oak   DINING Table ')).toBe('oak dining table');
  });

  it('PROD-01 · removes diacritics and tatweel', () => {
    expect(normalizeSearch('كُرْسِيٌّ')).toBe('كرسي');
    expect(normalizeSearch('كـــرسي')).toBe('كرسي'); // tatweel
  });

  it('PROD-01 · folds alef variants, ta marbuta and alef maqsura', () => {
    expect(normalizeSearch('أريكة إيجار آمن')).toBe('اريكه ايجار امن');
    expect(normalizeSearch('مقهى')).toBe('مقهي'); // ى -> ي
  });

  it('PROD-01 · converts Arabic-Indic and Eastern Arabic-Indic digits to ASCII', () => {
    expect(normalizeSearch('طاولة ٢٠٢٦')).toBe('طاوله 2026');
    expect(normalizeSearch('۲۰۲۶')).toBe('2026'); // U+06F0 range
  });

  it('PROD-01 · buildSearchText joins both locales through the same normalisation', () => {
    expect(buildSearchText({ en: 'Velvet Sofa', ar: 'كنبةٌ مخملية' })).toBe(
      'velvet sofa كنبه مخمليه',
    );
  });
});

describe('PROD-01 · multi-word search (rule 9: every word escaped, owner 2026-11-24)', () => {
  /** Every string that reaches a Prisma `contains`/`equals` in the built where-object. */
  const containsValues = (node: unknown): string[] => {
    if (Array.isArray(node)) return node.flatMap(containsValues);
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([key, value]) =>
        key === 'contains' || key === 'equals'
          ? typeof value === 'string'
            ? [value]
            : []
          : containsValues(value),
      );
    }
    return [];
  };

  it('PROD-01 · every word of a multi-word query is regex-escaped, in each of its OR branches', () => {
    const values = containsValues(searchWhere('a.b (sofa) [x] c*d'));
    expect(values.length).toBeGreaterThan(0);
    // nothing reaches Prisma with an unescaped metacharacter...
    for (const v of values) expect(v, v).not.toMatch(/(^|[^\\])[.*+?^${}()|[\]]/);
    // ...and each word is present in its escaped form
    for (const word of ['a.b', '(sofa)', '[x]', 'c*d'])
      expect(values, word).toContain(escapeRegex(word));
    // a plural is escaped in its stemmed form too
    const plural = containsValues(searchWhere('(sofas)'));
    expect(plural).toContain(escapeRegex('(sofas)'));
  });

  it('PROD-01 · the words are AND-ed and each word is an OR over the searched fields', () => {
    const where = searchWhere('oak table') as { AND: { OR: unknown[] }[] };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]!.OR.length).toBe(6); // searchText, description en/ar, category en/ar, material
    expect(searchTerms('  Oak   DINING  Table ')).toEqual(['oak', 'dining', 'table']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('PROD-01 · the word cap is 6', () => {
    expect(MAX_SEARCH_WORDS).toBe(6);
    expect(searchTerms('one two three four five six').length).toBe(MAX_SEARCH_WORDS);
    expect(searchTerms('one two three four five six seven').length).toBeGreaterThan(
      MAX_SEARCH_WORDS,
    );
  });
});
