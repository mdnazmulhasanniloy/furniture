import { z } from 'zod';
import { MAX_SEARCH_LENGTH, MAX_SEARCH_WORDS, searchTerms } from '../../lib/searchText.js';

const MAX_MONEY = 100_000_000; // halalas = 1,000,000 SAR (owner 2026-11-22)
const MAX_STOCK = 100_000;

/**
 * Locale rules (I18N-02, owner 2026-11-22) are status-dependent (DRAFT: >=1 non-empty locale;
 * PUBLISHED: both) and apply to the MERGED result on patch, so they live in the service, not here.
 */
const localized = (max: number) =>
  z.object({ en: z.string().trim().max(max), ar: z.string().trim().max(max) }).strict();
const localizedAlt = z
  .object({ en: z.string().trim().min(1).max(200), ar: z.string().trim().min(1).max(200) })
  .strict();

const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes only');

const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

/** Only the R2 `key` is trusted; the server recomputes `url` (ADR-010). */
const imageInput = z
  .object({ key: z.string().min(1).max(300), alt: localizedAlt.optional() })
  .strict();
const images = z
  .array(imageInput)
  .max(8)
  .refine((list) => new Set(list.map((i) => i.key)).size === list.length, {
    message: 'Image keys must be distinct',
  });

const positive = z.number().positive().finite();
const dimensions = z
  .object({
    widthCm: positive.optional(),
    depthCm: positive.optional(),
    heightCm: positive.optional(),
    weightKg: positive.optional(),
  })
  .strict();

const productFields = {
  title: localized(120),
  description: localized(5000),
  slug,
  sku: z.string().trim().min(1).max(40).nullable(),
  type: z.enum(['NEW', 'RESALE']),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']),
  conditionNotes: localized(1000).nullable(),
  price: z.number().int().min(0).max(MAX_MONEY),
  compareAtPrice: z.number().int().min(0).max(MAX_MONEY).nullable(),
  stock: z.number().int().min(0).max(MAX_STOCK),
  categoryId: objectId,
  images,
  dimensions: dimensions.nullable(),
  material: z.string().trim().min(1).max(60).nullable(),
  color: z.string().trim().min(1).max(60).nullable(),
  isFeatured: z.boolean(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
};

/** ADM-02. Strict: unknown fields (url, searchText, updatedAt, ...) are a 422. */
export const createProductBody = z
  .object(productFields)
  .partial({
    sku: true,
    conditionNotes: true,
    compareAtPrice: true,
    images: true,
    dimensions: true,
    material: true,
    color: true,
    isFeatured: true,
    status: true,
  })
  .strict();

/** Optimistic concurrency (owner 2026-11-22): `expectedUpdatedAt` plus at least one field to change. */
export const updateProductBody = z
  .object({ expectedUpdatedAt: z.coerce.date(), ...productFields })
  .partial()
  .required({ expectedUpdatedAt: true })
  .strict()
  .refine((b) => Object.keys(b).length > 1, {
    message: 'At least one field to change is required',
  });

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(',')))
    // zod 4 types the array's input as `input<T>[]`; the pipe hands it plain `string[]`, which
    // `item` validates at runtime, so widen the input type param only.
    .pipe(z.array(item as z.ZodType<z.output<T>, string>).min(1));
const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');
const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(24);

/** PROD-01. Unknown query params are stripped (shareable URLs may carry extras). */
export const publicListQuery = z
  .object({
    // Capped (owner 2026-11-24): each word adds six regex conditions to the query, so a long or
    // many-word `q` is rejected instead of being run.
    q: z
      .string()
      .max(MAX_SEARCH_LENGTH)
      .refine((v) => searchTerms(v).length <= MAX_SEARCH_WORDS, {
        message: `Search is limited to ${MAX_SEARCH_WORDS} words`,
      })
      .optional(),
    category: z.string().max(60).optional(),
    type: z.enum(['NEW', 'RESALE']).optional(),
    condition: csv(z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR'])).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    material: z.string().max(60).optional(),
    inStock: boolParam.optional(),
    featured: boolParam.optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'featured']).default('newest'),
    page,
    limit,
  })
  // QA 2026-11-24: a reversed range (min 3000, max 1000) is a mistake, not "no products found".
  // Negative and non-numeric values are already rejected by the coercion above.
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    path: ['minPrice'],
    message: 'minPrice must be less than or equal to maxPrice',
  });

/** ADM-02 list. */
export const adminListQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
  type: z.enum(['NEW', 'RESALE']).optional(),
  page,
  limit,
});

export type CreateProductBody = z.infer<typeof createProductBody>;
export type UpdateProductBody = z.infer<typeof updateProductBody>;
export type PublicListQuery = z.infer<typeof publicListQuery>;
export type AdminListQuery = z.infer<typeof adminListQuery>;
