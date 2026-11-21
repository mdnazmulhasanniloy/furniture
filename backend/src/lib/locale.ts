import type { Locale } from '../emails/types.js';

/** First supported language (`ar` | `en`) of an Accept-Language header, honouring q-values; undefined if none. */
export function parseAcceptLanguage(header: string | undefined): Locale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
      return {
        lang: tag.trim().toLowerCase().split('-')[0],
        q: q === undefined ? 1 : Number(q),
        index,
      };
    })
    .filter((x) => (x.lang === 'ar' || x.lang === 'en') && x.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return ranked[0]?.lang as Locale | undefined;
}
