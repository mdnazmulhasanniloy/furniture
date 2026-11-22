import { OrderStatus } from '@prisma/client';
import { z } from 'zod';

/** ORD-01 (owner 2026-11-22): `expectedTotal` is required — the customer must have seen the total. */
export const placeOrderBody = z
  .object({
    // A malformed id is handled as 404 in the service (T-007 rule, same as the cart's addressId).
    addressId: z.string().min(1).max(60),
    customerNote: z.string().trim().max(500).optional(),
    expectedTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

/** Required `Idempotency-Key` header: a UUID, one per checkout attempt (missing/malformed -> 422). */
export const idempotencyKey = z
  .string({ required_error: 'Idempotency-Key header is required' })
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'Idempotency-Key must be a UUID',
  );

/** ORD-02 list. */
export const listOrdersQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------- ADM-04 admin orders (T-014)

/** YYYY-MM-DD that is a real calendar date (parsed as an Asia/Riyadh day in the service). */
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00+03:00`)), 'Not a valid calendar date');

/** `q` is matched literally (escapeRegex, rule 9) against orderNo/email, and as a phone when it normalises. */
export const adminListOrdersQuery = z.object({
  status: z.nativeEnum(OrderStatus).optional(),
  q: z.string().trim().max(100).optional(),
  from: isoDay.optional(),
  to: isoDay.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Transition body. The note is internal; CANCELLED requires it (the cancel reason, owner 2026-11-22). */
export const orderStatusBody = z
  .object({
    status: z.nativeEnum(OrderStatus),
    note: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.status === 'CANCELLED' && val.note === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'A cancel reason note (3-500 characters) is required to cancel an order',
      });
    }
  });

/** `adminNote` is required in the body; `null` (or an empty string) clears it. */
export const adminNoteBody = z
  .object({
    adminNote: z.union([
      z
        .string()
        .trim()
        .max(2000)
        .transform((s) => (s === '' ? null : s)),
      z.null(),
    ]),
  })
  .strict();

export type PlaceOrderBody = z.infer<typeof placeOrderBody>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;
export type AdminListOrdersQuery = z.infer<typeof adminListOrdersQuery>;
export type OrderStatusBody = z.infer<typeof orderStatusBody>;
export type AdminNoteBody = z.infer<typeof adminNoteBody>;
