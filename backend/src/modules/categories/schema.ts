import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);

/** Both locales required (I18N-02). */
const localizedName = z.object({ en: text(60), ar: text(60) }).strict();
const localizedAlt = z.object({ en: text(200), ar: text(200) }).strict();

const slug = z
  .string()
  .trim()
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase letters, digits and single dashes only');

/** Only the R2 `key` is trusted; the server recomputes `url` (ADR-010). */
const imageInput = z
  .object({ key: z.string().min(1).max(300), alt: localizedAlt.optional() })
  .strict();

const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

const categoryFields = {
  name: localizedName,
  slug,
  image: imageInput.nullable(),
  parentId: objectId.nullable(),
  sortOrder: z.number().int().min(0),
  isActive: z.boolean(),
};

/** ADM-03. Strict: unknown fields (url, children, productCount, ...) are a 422. */
export const createCategoryBody = z
  .object(categoryFields)
  .partial({ image: true, parentId: true, sortOrder: true, isActive: true })
  .strict();

export const updateCategoryBody = z
  .object(categoryFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

export type CreateCategoryBody = z.infer<typeof createCategoryBody>;
export type UpdateCategoryBody = z.infer<typeof updateCategoryBody>;
