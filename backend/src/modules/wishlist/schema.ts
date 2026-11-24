import { z } from 'zod';

/** FAV-01 merge. Malformed ids are skipped (not rejected) by the service, so any short string is accepted here. */
export const mergeBody = z.object({ productIds: z.array(z.string().max(64)).max(100) }).strict();

export type MergeBody = z.infer<typeof mergeBody>;
