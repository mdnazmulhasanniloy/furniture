import { AppError } from '../../lib/errors.js';
import { hit, limitKey } from '../../lib/rateLimit.js';
import { assertUploadAllowed, createUploadPresign, type R2Context } from '../../lib/r2.js';
import type { PresignBody } from './schema.js';

export const PRESIGN_LIMIT = 30;
export const PRESIGN_WINDOW_SECONDS = 600;

/** 30 presigns per admin per 10 minutes (T-024 store). Every authenticated request counts, rejected ones too. */
export async function limitPresign(userId: string, ctx: R2Context): Promise<void> {
  const r = await hit(
    limitKey('upload', 'user', userId),
    PRESIGN_LIMIT,
    PRESIGN_WINDOW_SECONDS,
    ctx,
  );
  if (!r.allowed) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many upload requests', {
      retryAfterSeconds: r.retryAfterSeconds,
    });
  }
}

export async function presign(userId: string, body: PresignBody) {
  const contentType = assertUploadAllowed(body);
  return createUploadPresign({
    contentType,
    size: body.size,
    uploadedById: userId,
    scope: 'admin',
  });
}
