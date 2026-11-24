import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BANNERS,
  CONDITION_NOTES,
  PRODUCTS,
  TESTIMONIALS,
} from '../../../scripts/demo-data/catalog.js';

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
