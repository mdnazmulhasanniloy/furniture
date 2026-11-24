import { z } from 'zod';
import { saudiPhone } from '../../lib/phone.js';
import { email, locale, name } from '../auth/schema.js';

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(24);

/** ADM-05: `q` is matched literally (escapeRegex, rule 9) against email/names, and as a phone when it normalises. */
export const listCustomersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  /** CR-011: active (not blocked, not deleted), blocked (not deleted) or deleted; default = active and blocked. */
  status: z.enum(['active', 'blocked', 'deleted']).optional(),
  page,
  limit,
});

/** ADM-05 detail: pagination of the customer's orders. */
export const customerOrdersQuery = z.object({ page, limit });

export const blockBody = z.object({ isBlocked: z.boolean() }).strict();

/** CR-011 (ADM-17): blocking a customer needs a reason (admin-only); unblocking may carry one, which is not stored. */
export const blockCustomerBody = z
  .object({ isBlocked: z.boolean(), reason: z.string().trim().min(3).max(300).optional() })
  .strict()
  .superRefine((v, ctx) => {
    if (v.isBlocked && v.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A reason of 3 to 300 characters is required to block a customer',
      });
    }
  });

/**
 * CR-011 (ADM-17): an admin may change a customer's name and phone and NOTHING else (strict: email, password, role,
 * isBlocked, ... are all 422). `phone: null` clears it. `expectedUpdatedAt` is the optimistic-concurrency token.
 */
export const updateCustomerBody = z
  .object({
    expectedUpdatedAt: z.iso.datetime().transform((v) => new Date(v)),
    firstName: name.optional(),
    lastName: name.optional(),
    phone: saudiPhone.nullable().optional(),
  })
  .strict()
  .refine((v) => v.firstName !== undefined || v.lastName !== undefined || v.phone !== undefined, {
    message: 'Send at least one of firstName, lastName or phone',
  });

/** CR-011 (ADM-17): the admin types the customer's email; the server compares it again (not only the UI). */
export const deleteCustomerBody = z
  .object({ confirmEmail: z.string().trim().min(1).max(254) })
  .strict();

/**
 * ADM-11 (owner 2026-11-22): no password — the invitee sets their own via POST /auth/accept-invite.
 * `preferredLocale` is stored on the user and drives the invite emails (not the inviter's Accept-Language).
 */
export const inviteAdminBody = z
  .object({
    firstName: name,
    lastName: name,
    email,
    preferredLocale: locale.default('ar'),
  })
  .strict();

export type ListCustomersQuery = z.infer<typeof listCustomersQuery>;
export type CustomerOrdersQuery = z.infer<typeof customerOrdersQuery>;
export type BlockBody = z.infer<typeof blockBody>;
export type BlockCustomerBody = z.infer<typeof blockCustomerBody>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerBody>;
export type DeleteCustomerBody = z.infer<typeof deleteCustomerBody>;
export type InviteAdminBody = z.infer<typeof inviteAdminBody>;
