import { describe, expect, it } from 'vitest';
import { renderEmail, resolveLocale } from '../../src/emails/render.js';
import {
  TEMPLATE_NAMES,
  type Locale,
  type OrderStatusName,
  type TemplateDataMap,
} from '../../src/emails/types.js';

const otp = { firstName: 'Sara', code: '987987', ttlSeconds: 600 };
const placed = {
  firstName: 'Sara',
  orderNo: 'FX-1001',
  items: [
    { title: { en: 'Oak Chair', ar: 'كرسي بلوط' }, qty: 2, unitPrice: 125_050 },
    { title: { en: 'Lamp', ar: 'مصباح' }, qty: 1, unitPrice: 9_900 },
  ],
  subtotal: 260_000,
  deliveryFee: 5_000,
  vatAmount: 39_000,
  total: 265_000,
};
const STATUSES: OrderStatusName[] = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
];
const adminInvite = {
  firstName: 'Omar',
  code: '987987',
  ttlSeconds: 600,
  adminUrl: 'https://admin.example.com',
};

const samples: TemplateDataMap = {
  'otp-verify': otp,
  'otp-reset': otp,
  'password-changed': { firstName: 'Sara' },
  // T-108: the security email after a password change (the time is rendered in Riyadh).
  'admin-password-changed': { firstName: 'Sara', at: '2026-11-25T11:32:00.000Z' },
  'order-placed': placed,
  'order-status': { firstName: 'Sara', orderNo: 'FX-1001', status: 'CONFIRMED' },
  'admin-invite': adminInvite,
};
const locales: Locale[] = ['en', 'ar'];

function expectDir(html: string, locale: Locale) {
  expect(html).toContain(`lang="${locale}"`);
  expect(html).toContain(locale === 'ar' ? 'dir="rtl"' : 'dir="ltr"');
  if (locale === 'en') expect(html).not.toContain('dir="rtl"');
}

describe('email templates', () => {
  it.each(TEMPLATE_NAMES.flatMap((t) => locales.map((l) => [t, l] as const)))(
    'NFR-05 · %s renders non-empty subject/html/text in %s',
    (template, locale) => {
      const out = renderEmail(template, locale, samples[template] as never);
      expect(out.subject.length).toBeGreaterThan(0);
      expect(out.html.length).toBeGreaterThan(0);
      expect(out.text.length).toBeGreaterThan(0);
      expectDir(out.html, locale);
    },
  );

  it.each(locales)('AUTH-01 · otp-verify (%s) contains the code', (locale) => {
    const out = renderEmail('otp-verify', locale, otp);
    expect(out.html).toContain('987987');
    expect(out.text).toContain('987987');
  });

  it.each(locales)('AUTH-03 · otp-reset (%s) contains the code', (locale) => {
    const out = renderEmail('otp-reset', locale, otp);
    expect(out.html).toContain('987987');
    expect(out.text).toContain('987987');
    expectDir(out.html, locale);
  });

  // T-004 review: the reset mail must tell a recipient who did not ask to ignore it.
  const IGNORE: Record<Locale, [string, string]> = {
    en: [
      'If you did not request a reset, you can ignore this email',
      'If you did not request a reset, ignore this email.',
    ],
    ar: ['إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة', 'إذا لم تطلب ذلك، تجاهل هذه الرسالة.'],
  };
  it.each(locales)(
    'AUTH-03 · otp-reset (%s) tells a recipient who did not request it to ignore the email',
    (locale) => {
      const out = renderEmail('otp-reset', locale, otp);
      expect(out.html).toContain(IGNORE[locale][0]);
      expect(out.text).toContain(IGNORE[locale][1]);
    },
  );

  // 987987 contains none of the tested TTL digits (1, 0, 2, 5), so a bare digit cannot match by accident.
  const MINUTES: Record<Locale, [number, string][]> = {
    en: [
      [60, 'valid for 1 minute'],
      [120, 'valid for 2 minutes'],
      [300, 'valid for 5 minutes'],
      [600, 'valid for 10 minutes'],
      [900, 'valid for 15 minutes'],
    ],
    ar: [
      [60, 'صالح لمدة دقيقة واحدة'],
      [120, 'صالح لمدة دقيقتان'],
      [300, 'صالح لمدة 5 دقائق'],
      [600, 'صالح لمدة 10 دقائق'],
      [900, 'صالح لمدة 15 دقيقة'],
    ],
  };

  describe.each(['otp-verify', 'otp-reset', 'admin-invite'] as const)(
    '%s TTL wording',
    (template) => {
      it.each(locales.flatMap((l) => MINUTES[l].map(([s, phrase]) => [l, s, phrase] as const)))(
        'AUTH-01 / AUTH-03 · (%s) %i s -> "%s"',
        (locale, ttlSeconds, phrase) => {
          const data = { ...otp, ttlSeconds, adminUrl: 'https://admin.example.com' };
          const out = renderEmail(template, locale, data as never);
          expect(out.html).toContain(phrase);
          expect(out.text).toContain(phrase);
        },
      );

      it('AUTH-01 · never renders "1 minutes" and rounds partial minutes up', () => {
        const one = renderEmail(template, 'en', { ...otp, ttlSeconds: 60, adminUrl: 'x' } as never);
        expect(one.html).not.toContain('1 minutes');
        const partial = renderEmail(template, 'en', {
          ...otp,
          ttlSeconds: 61,
          adminUrl: 'x',
        } as never);
        expect(partial.html).toContain('valid for 2 minutes');
      });
    },
  );

  it.each(locales)('ORD-04 · order-placed (%s) shows order number, items and totals', (locale) => {
    const out = renderEmail('order-placed', locale, placed);
    expect(out.html).toContain('FX-1001');
    expect(out.html).toContain(locale === 'en' ? 'Oak Chair' : 'كرسي بلوط');
    expect(out.html).toContain('2,501.00'); // 2 × 1,250.50 SAR
    expect(out.html).toContain('2,650.00'); // total
    expect(out.html).toContain('390.00'); // VAT
    expect(out.text).toContain('FX-1001');
  });

  it('ORD-04 · order-placed omits the VAT line when the VAT amount is 0', () => {
    const out = renderEmail('order-placed', 'en', { ...placed, vatAmount: 0 });
    expect(out.html).not.toContain('VAT');
    expect(out.text).not.toContain('VAT');
  });

  it.each(locales.flatMap((l) => STATUSES.map((s) => [l, s] as const)))(
    'ORD-04 · order-status (%s) renders status %s',
    (locale, status) => {
      const out = renderEmail('order-status', locale, {
        firstName: 'Sara',
        orderNo: 'FX-1001',
        status,
      });
      expect(out.html).toContain('FX-1001');
      expect(out.subject).toContain('FX-1001');
      expectDir(out.html, locale);
    },
  );

  it('ORD-04 · order-status labels differ per locale and per status', () => {
    const en = new Set(
      STATUSES.map(
        (s) => renderEmail('order-status', 'en', { ...samples['order-status'], status: s }).subject,
      ),
    );
    const ar = new Set(
      STATUSES.map(
        (s) => renderEmail('order-status', 'ar', { ...samples['order-status'], status: s }).subject,
      ),
    );
    expect(en.size).toBe(STATUSES.length);
    expect(ar.size).toBe(STATUSES.length);
  });

  it.each(locales)(
    'AUTH-01 · admin-invite (%s) contains the OTP and ADMIN_URL, not a magic link',
    (locale) => {
      const out = renderEmail('admin-invite', locale, adminInvite);
      expect(out.html).toContain('987987');
      expect(out.text).toContain('987987');
      expect(out.html).toContain('https://admin.example.com');
      expect(out.text).toContain('https://admin.example.com');
      expect(out.html).not.toMatch(/token=|magic/i);
    },
  );

  it.each(locales)(
    'AUTH-03 · admin-password-changed (%s) shows the Riyadh time and carries no secret',
    (locale) => {
      const out = renderEmail('admin-password-changed', locale, {
        firstName: 'Sara',
        at: '2026-11-25T11:32:00.000Z',
      });
      // 11:32 UTC is 14:32 in Riyadh, with Western digits (B-015).
      expect(out.text).toContain('14:32');
      expect(out.html).toContain('14:32');
      expect(out.text).toContain(locale === 'en' ? 'Riyadh' : 'الرياض');
      expect(out.subject).toContain('Furnixa');
      expect(out.text).not.toMatch(/password[:=]|token|code|http/i);
    },
  );

  it('NFR-05 · user-supplied values are HTML-escaped in every template', () => {
    const evil = '<script>alert(1)</script>';
    for (const locale of locales) {
      for (const t of TEMPLATE_NAMES) {
        const data = JSON.parse(JSON.stringify(samples[t]));
        data.firstName = evil;
        if (t === 'order-placed') data.items[0].title = { en: evil, ar: evil };
        if (t === 'admin-invite') data.adminUrl = `https://x.test/?a="${evil}"`;
        const out = renderEmail(t, locale, data);
        expect(out.html).not.toContain(evil);
        expect(out.html).toContain('&lt;script&gt;');
      }
    }
  });
});

describe('resolveLocale', () => {
  it('I18N-01 · uses the recipient preferredLocale', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('ar')).toBe('ar');
  });
  it('I18N-01 · falls back to ar only when missing or unknown', () => {
    expect(resolveLocale(undefined)).toBe('ar');
    expect(resolveLocale(null)).toBe('ar');
    expect(resolveLocale('fr')).toBe('ar');
  });
});
