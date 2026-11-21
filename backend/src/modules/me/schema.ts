import { z } from 'zod';
import { saudiPhone } from '../../lib/phone.js';

const text = (max: number) => z.string().trim().min(1).max(max);

/** PROF-01. Strict: unknown fields (email, role, isBlocked, avatar ...) are a 422, never ignored. */
export const updateProfileBody = z
  .object({
    firstName: text(40),
    lastName: text(40),
    phone: saudiPhone.nullable(),
    preferredLocale: z.enum(['ar', 'en']),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

const addressFields = {
  label: text(30),
  fullName: text(80),
  phone: saudiPhone,
  cityCode: z.string().trim().min(1).max(60),
  area: text(80),
  street: text(200),
  notes: z.string().trim().max(300).optional(),
  isDefault: z.boolean().optional(),
};

/** PROF-02 */
export const createAddressBody = z.object(addressFields).strict();
export const updateAddressBody = z
  .object(addressFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'At least one field is required' });

export type UpdateProfileBody = z.infer<typeof updateProfileBody>;
export type CreateAddressBody = z.infer<typeof createAddressBody>;
export type UpdateAddressBody = z.infer<typeof updateAddressBody>;
