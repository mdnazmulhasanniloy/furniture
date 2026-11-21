import { adminInvite as adminInviteAr } from './templates/ar/admin-invite.js';
import { orderPlaced as orderPlacedAr } from './templates/ar/order-placed.js';
import { orderStatus as orderStatusAr } from './templates/ar/order-status.js';
import { otpReset as otpResetAr } from './templates/ar/otp-reset.js';
import { passwordChanged as passwordChangedAr } from './templates/ar/password-changed.js';
import { otpVerify as otpVerifyAr } from './templates/ar/otp-verify.js';
import { adminInvite as adminInviteEn } from './templates/en/admin-invite.js';
import { orderPlaced as orderPlacedEn } from './templates/en/order-placed.js';
import { orderStatus as orderStatusEn } from './templates/en/order-status.js';
import { otpReset as otpResetEn } from './templates/en/otp-reset.js';
import { passwordChanged as passwordChangedEn } from './templates/en/password-changed.js';
import { otpVerify as otpVerifyEn } from './templates/en/otp-verify.js';
import {
  DEFAULT_LOCALE,
  type Locale,
  type RenderedEmail,
  type TemplateDataMap,
  type TemplateFn,
  type TemplateName,
} from './types.js';

const registry: { [K in TemplateName]: Record<Locale, TemplateFn<TemplateDataMap[K]>> } = {
  'otp-verify': { en: otpVerifyEn, ar: otpVerifyAr },
  'otp-reset': { en: otpResetEn, ar: otpResetAr },
  'password-changed': { en: passwordChangedEn, ar: passwordChangedAr },
  'order-placed': { en: orderPlacedEn, ar: orderPlacedAr },
  'order-status': { en: orderStatusEn, ar: orderStatusAr },
  'admin-invite': { en: adminInviteEn, ar: adminInviteAr },
};

/** Recipient's `preferredLocale`; `ar` only when it is missing or unknown. */
export function resolveLocale(preferredLocale?: string | null): Locale {
  return preferredLocale === 'en' || preferredLocale === 'ar' ? preferredLocale : DEFAULT_LOCALE;
}

export function renderEmail<K extends TemplateName>(
  template: K,
  locale: Locale,
  data: TemplateDataMap[K],
): RenderedEmail {
  const fn = registry[template]?.[locale] as TemplateFn<TemplateDataMap[K]> | undefined;
  if (!fn) throw new Error(`Unknown email template "${template}" for locale "${locale}"`);
  return fn(data);
}
