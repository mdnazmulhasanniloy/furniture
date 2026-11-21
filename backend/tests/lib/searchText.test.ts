import { describe, expect, it } from 'vitest';
import { buildSearchText, normalizeSearch } from '../../src/lib/searchText.js';

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
