import { z } from 'zod';

/**
 * Shape only. The business rules (type jpeg/png/webp, size <= 5 MB) are 422 `UPLOAD_NOT_ALLOWED` and live in
 * `assertUploadAllowed`; a malformed body is 422 `VALIDATION_ERROR`.
 */
export const presignBody = z
  .object({
    fileName: z.string().min(1).max(255), // informational, never used in the key
    contentType: z.string().min(1).max(100),
    size: z.number().int().min(1),
  })
  .strict();
export type PresignBody = z.infer<typeof presignBody>;
