import { z } from 'zod';
import { email, locale, name } from '../auth/schema.js';

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(24);

/** ADM-05: `q` is matched literally (escapeRegex, rule 9) against email/names, and as a phone when it normalises. */
export const listCustomersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page,
  limit,
});

/** ADM-05 detail: pagination of the customer's orders. */
export const customerOrdersQuery = z.object({ page, limit });

export const blockBody = z.object({ isBlocked: z.boolean() }).strict();

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
export type InviteAdminBody = z.infer<typeof inviteAdminBody>;
