import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BANNERS,
  CONDITION_NOTES,
  PRODUCTS,
  TESTIMONIALS,
} from '../../../scripts/demo-data/catalog.js';
import { DELIVERY_CITIES } from '../../../prisma/seed/data.js';

// Q-2 / B-036: until the owner confirms in writing that every pre-owned item is inspected, nothing
// the demo seed writes (and the storefront then shows) may claim inspection, in English or Arabic.
const CLAIM = /inspect|فحص|مفحوص/i;

describe('B-036 · demo seed makes no inspection claims', () => {
  it('B-036 · products, condition notes, banners and testimonials carry no inspection wording', () => {
    const text = JSON.stringify({ PRODUCTS, CONDITION_NOTES, BANNERS, TESTIMONIALS });
    expect(text.match(CLAIM)).toBeNull();
  });

  it('B-036 · the seed and catalog sources (home section titles, subtitles) carry none either', () => {
    const dir = path.resolve(import.meta.dirname, '../../../scripts/demo-data');
    for (const file of ['catalog.ts', 'seed.ts']) {
      const lines = readFileSync(path.join(dir, file), 'utf8').split('\n');
      const hits = lines.filter((l) => CLAIM.test(l) && !l.trimStart().startsWith('//'));
      expect(hits, `${file}: ${hits.join(' | ')}`).toEqual([]);
    }
  });
});

// QA 2026-11-24 item 7: delivery is to the seeded cities only. The demo banner may name how many there are,
// but never "all of Saudi Arabia", and the number must be the number of cities checkout actually offers.
const COUNTRY_CLAIM = /across saudi|all over saudi|anywhere in saudi|جميع مدن|كل مدن|جميع أنحاء/i;

describe('QA-7 · demo seed delivery wording', () => {
  it('QA-7 · no demo copy claims delivery everywhere in the Kingdom', () => {
    const text = JSON.stringify({ PRODUCTS, CONDITION_NOTES, BANNERS, TESTIMONIALS });
    expect(text.match(COUNTRY_CLAIM)).toBeNull();
  });

  it('QA-7 · every delivery count in a banner equals the seeded active city count', () => {
    const cities = DELIVERY_CITIES.length;
    expect(cities).toBe(6);
    const texts = BANNERS.flatMap((b) => [b.title, b.subtitle, b.ctaLabel])
      .filter((x): x is { en: string; ar: string } => !!x)
      .flatMap((x) => [x.en, x.ar]);
    const withCount = texts.filter((x) => /\d/.test(x) && /cities|مدن/i.test(x));
    expect(withCount.length).toBeGreaterThan(0); // the hero names the count
    for (const text of withCount) {
      const numbers = (text.match(/\d+/g) ?? []).map(Number);
      expect(numbers, text).toContain(cities);
    }
  });
});
