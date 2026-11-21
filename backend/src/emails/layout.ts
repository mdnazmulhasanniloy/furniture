import type { Locale, RenderedEmail } from './types.js';

// Working brand name until B-006 is resolved.
export const BRAND = 'Furnixa';

export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Halalas -> "1,234.50 SAR" / "1,234.50 ر.س" (Western digits, B-015). */
export function formatMoney(halalas: number, locale: Locale): string {
  const n = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(halalas / 100);
  return locale === 'ar' ? `${n} ر.س` : `${n} SAR`;
}

const pluralRules = {
  en: new Intl.PluralRules('en'),
  ar: new Intl.PluralRules('ar'),
};

/** TTL seconds -> whole minutes (rounded up, at least 1) with correct en/ar plural wording. */
export function formatMinutes(ttlSeconds: number, locale: Locale): string {
  const n = Math.max(1, Math.ceil(ttlSeconds / 60));
  const category = pluralRules[locale].select(n);
  if (locale === 'en') return category === 'one' ? `${n} minute` : `${n} minutes`;
  switch (category) {
    case 'one':
      return 'دقيقة واحدة';
    case 'two':
      return 'دقيقتان';
    case 'few':
      return `${n} دقائق`; // 3-10
    default:
      return `${n} دقيقة`; // many (11-99) and other
  }
}

export function otpBox(code: string): string {
  return `<p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:24px 0;direction:ltr;text-align:center">${escapeHtml(code)}</p>`;
}

/** Shared HTML shell. Arabic gets `lang="ar" dir="rtl"`. */
export function layout(
  locale: Locale,
  subject: string,
  bodyHtml: string,
  text: string,
): RenderedEmail {
  const rtl = locale === 'ar';
  const html = `<!doctype html>
<html lang="${locale}" dir="${rtl ? 'rtl' : 'ltr'}">
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body dir="${rtl ? 'rtl' : 'ltr'}" style="margin:0;padding:24px;background:#f6f4f1;font-family:Arial,Helvetica,sans-serif;color:#222;text-align:${rtl ? 'right' : 'left'}">
<div style="max-width:560px;margin:0 auto;background:#fff;padding:24px;border-radius:8px">
<h2 style="margin-top:0">${BRAND}</h2>
${bodyHtml}
</div>
</body>
</html>`;
  return { subject, html, text };
}
