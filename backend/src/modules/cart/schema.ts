import { z } from 'zod';

const MAX_QTY = 100_000; // matches the T-010 stock cap
const objectId = z.string().regex(/^[a-f0-9]{24}$/, 'Invalid id');

/** CART-01. qty 0 removes the line. */
export const putItemBody = z
  .object({ productId: objectId, qty: z.number().int().min(0).max(MAX_QTY) })
  .strict();

/** CART-01 merge. Duplicate productIds are allowed here and combined with max in the service. */
export const mergeBody = z
  .object({
    items: z
      .array(z.object({ productId: objectId, qty: z.number().int().min(1).max(MAX_QTY) }).strict())
      .max(100),
  })
  .strict();

/**
 * Unknown params are stripped. A malformed `addressId` is handled as 404 in the service
 * (same rule as T-007: foreign or malformed address id -> 404).
 */
export const getCartQuery = z.object({ addressId: z.string().max(60).optional() });

export type PutItemBody = z.infer<typeof putItemBody>;
export type MergeBody = z.infer<typeof mergeBody>;
export type GetCartQuery = z.infer<typeof getCartQuery>;
