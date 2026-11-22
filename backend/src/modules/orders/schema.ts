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

export type PlaceOrderBody = z.infer<typeof placeOrderBody>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuery>;
