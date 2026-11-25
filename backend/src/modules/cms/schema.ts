import { z } from 'zod';
import { normalizeSaudiContactPhone, SAUDI_CONTACT_PHONE_MAX_LENGTH } from '../../lib/phone.js';
import { isSafeHref } from '../../lib/safeHtml.js';

const MAX_MONEY = 100_000_000; // halalas (owner 2026-11-22, same cap as products)

const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');
const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes only');

/** Both locales non-empty (banner/section titles are shown immediately, I18N-02). */
const localizedRequired = (max: number) =>
  z
    .object({ en: z.string().trim().min(1).max(max), ar: z.string().trim().min(1).max(max) })
    .strict();
/** Locales may be empty; the publish gate (service) decides how many are required. */
const localizedLoose = (max: number) =>
  z.object({ en: z.string().trim().max(max), ar: z.string().trim().max(max) }).strict();

/** `z.coerce.date().nullable()` would turn null into new Date(0); check null first. */
const nullableDate = z.union([z.null(), z.coerce.date()]);

const safeHref = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(isSafeHref, 'Must be a same-site path ("/...") or an absolute https:// URL');

// ---------------------------------------------------------------- banners (ADM-06)

/** Banner images require localized alt text (UI-02, owner 2026-11-22). */
const percent = z.number().min(0).max(100);
/** CR-011: optional focal point, both coordinates or neither. */
const bannerImage = z
  .object({
    key: z.string().min(1).max(300),
    alt: localizedRequired(200),
    focalX: percent.optional(),
    focalY: percent.optional(),
  })
  .strict()
  .refine((v) => (v.focalX === undefined) === (v.focalY === undefined), {
    message: 'focalX and focalY must be sent together',
    path: ['focalX'],
  });

const bannerFields = {
  title: localizedRequired(120),
  subtitle: localizedRequired(200).nullable(),
  ctaLabel: localizedRequired(40).nullable(),
  ctaHref: safeHref.nullable(),
  imageDesktop: bannerImage,
  imageMobile: bannerImage.nullable(),
  startsAt: nullableDate,
  endsAt: nullableDate,
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
};

export const createBannerBody = z
  .object(bannerFields)
  .partial({
    subtitle: true,
    ctaLabel: true,
    ctaHref: true,
    imageMobile: true,
    startsAt: true,
    endsAt: true,
    sortOrder: true,
    isActive: true,
  })
  .strict();

/** Optimistic concurrency (owner 2026-11-22): `expectedUpdatedAt` plus at least one field to change. */
export const updateBannerBody = z
  .object({ expectedUpdatedAt: z.coerce.date(), ...bannerFields })
  .partial()
  .required({ expectedUpdatedAt: true })
  .strict()
  .refine((b) => Object.keys(b).length > 1, {
    message: 'At least one field to change is required',
  });

// ---------------------------------------------------------------- home sections (ADM-07)

const testimonial = z
  .object({ name: z.string().trim().min(1).max(80), quote: localizedRequired(500) })
  .strict();

/**
 * SHOP_THE_LOOK (ADM-15, T-110): the photo needs localized alt text (UI-02) **and its own pixel size** - the
 * storefront renders the look uncropped at that ratio, so a hotspot percentage means the same point of the
 * photo at every breakpoint. 1 to 6 hotspots, x and y in percent of the photo.
 */
const pixels = z.number().int().min(1).max(20000);
const lookImage = z
  .object({
    key: z.string().min(1).max(300),
    alt: localizedRequired(200),
    width: pixels,
    height: pixels,
  })
  .strict();

const look = z
  .object({
    image: lookImage,
    hotspots: z
      .array(
        z
          .object({
            x: z.number().min(0).max(100),
            y: z.number().min(0).max(100),
            productId: objectId,
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();

const sectionConfig = z
  .object({
    productIds: z.array(objectId).max(24).optional(),
    categoryIds: z.array(objectId).max(24).optional(),
    limit: z.number().int().min(1).max(24).optional(),
    bannerId: objectId.optional(),
    testimonials: z.array(testimonial).max(12).optional(),
    look: look.optional(),
  })
  .strict();

const sectionFields = {
  type: z.enum([
    'FEATURED_PRODUCTS',
    'NEW_ARRIVALS',
    'RESALE_PICKS',
    'CATEGORY_GRID',
    'PROMO_BANNER',
    'TESTIMONIALS',
    'SHOP_THE_LOOK',
  ]),
  title: localizedRequired(120),
  subtitle: localizedRequired(200).nullable(),
  config: sectionConfig,
  sortOrder: z.number().int().min(0),
  isVisible: z.boolean(),
};

export const createSectionBody = z
  .object(sectionFields)
  .partial({ subtitle: true, config: true, sortOrder: true, isVisible: true })
  .strict();

export const updateSectionBody = z
  .object({ expectedUpdatedAt: z.coerce.date(), ...sectionFields })
  .partial()
  .required({ expectedUpdatedAt: true })
  .strict()
  .refine((b) => Object.keys(b).length > 1, {
    message: 'At least one field to change is required',
  });

/** Must be exactly the set of existing section ids; verified against the DB in the service. */
export const reorderBody = z
  .object({ ids: z.array(objectId).min(1).max(100) })
  .strict()
  .refine((b) => new Set(b.ids).size === b.ids.length, { message: 'Ids must be distinct' });

// ---------------------------------------------------------------- pages (ADM-08)

const pageFields = {
  slug,
  title: localizedLoose(120),
  content: localizedLoose(50_000),
  metaTitle: localizedLoose(120).nullable(),
  metaDescription: localizedLoose(300).nullable(),
  isPublished: z.boolean(),
};

export const createPageBody = z
  .object(pageFields)
  .partial({ metaTitle: true, metaDescription: true, isPublished: true })
  .strict();

export const updatePageBody = z
  .object({ expectedUpdatedAt: z.coerce.date(), ...pageFields })
  .partial()
  .required({ expectedUpdatedAt: true })
  .strict()
  .refine((b) => Object.keys(b).length > 1, {
    message: 'At least one field to change is required',
  });

// ---------------------------------------------------------------- settings (ADM-09)

const vatRate = z
  .number()
  .min(0)
  .max(50)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-9, {
    message: 'At most 2 decimal places',
  });

const vatSetting = z
  .object({
    vatRate,
    applyToDelivery: z.boolean(),
    pricesIncludeVat: z.boolean(),
    registrationNumber: z
      .string()
      .regex(/^3\d{13}3$/, '15 digits, starting and ending with 3')
      .nullable()
      .optional(),
  })
  .strict();

const deliveryCity = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9-]+$/, 'Lowercase letters, digits and dashes only'),
    name: localizedRequired(60),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0),
    deliveryFee: z.number().int().min(0).max(MAX_MONEY).nullable().optional(),
  })
  .strict();

const socials = z
  .object({
    facebook: z.string().trim().max(300).nullable().optional(),
    instagram: z.string().trim().max(300).nullable().optional(),
    whatsapp: z.string().trim().max(300).nullable().optional(),
    tiktok: z.string().trim().max(300).nullable().optional(),
  })
  .strict();

const seo = z
  .object({
    title: localizedLoose(120).optional(),
    description: localizedLoose(300).optional(),
  })
  .strict();

/**
 * Contact details are optional (owner 2026-11-24, closes B-033): absent or `''` clears them and the storefront
 * footer hides that line, so saving VAT, the delivery fee or any other setting never requires contact details.
 * A non-empty value must be valid: an email address, or a Saudi phone stored as `+966XXXXXXXXX`.
 */
const optionalContactEmail = z
  .string()
  .trim()
  .max(120)
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Invalid email address')
  .optional();

const optionalContactPhone = z
  .string()
  .max(SAUDI_CONTACT_PHONE_MAX_LENGTH, 'Phone is too long')
  .transform((value, ctx) => {
    if (value.trim() === '') return '';
    const normalized = normalizeSaudiContactPhone(value);
    if (normalized === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid Saudi phone number' });
      return z.NEVER;
    }
    return normalized;
  })
  .optional();

/**
 * Full replace (owner 2026-11-22): absent optional fields are cleared. `currency` is fixed to SAR and not
 * accepted (strict -> 422). City immutability and last-active rules are T-022; here only shape is checked.
 */
export const putSettingsBody = z
  .object({
    expectedUpdatedAt: z.coerce.date(),
    storeName: localizedRequired(120),
    logo: z
      .object({ key: z.string().min(1).max(300), alt: localizedRequired(200).optional() })
      .strict()
      .nullable()
      .optional(),
    contactEmail: optionalContactEmail,
    contactPhone: optionalContactPhone,
    address: localizedLoose(300).nullable().optional(),
    socials: socials.nullable().optional(),
    deliveryFee: z.number().int().min(0).max(MAX_MONEY),
    freeDeliveryThreshold: z.number().int().min(0).max(MAX_MONEY).nullable().optional(),
    vat: vatSetting,
    deliveryCities: z
      .array(deliveryCity)
      .min(1)
      .max(100)
      .refine((list) => new Set(list.map((c) => c.code)).size === list.length, {
        message: 'City codes must be unique',
      })
      .refine((list) => list.some((c) => c.isActive), {
        message: 'At least one delivery city must stay active (ADM-13)',
      }),
    defaultLocale: z.enum(['en', 'ar']),
    seo: seo.nullable().optional(),
  })
  .strict();

export type CreateBannerBody = z.infer<typeof createBannerBody>;
export type UpdateBannerBody = z.infer<typeof updateBannerBody>;
export type CreateSectionBody = z.infer<typeof createSectionBody>;
export type UpdateSectionBody = z.infer<typeof updateSectionBody>;
export type ReorderBody = z.infer<typeof reorderBody>;
export type CreatePageBody = z.infer<typeof createPageBody>;
export type UpdatePageBody = z.infer<typeof updatePageBody>;
export type PutSettingsBody = z.infer<typeof putSettingsBody>;
