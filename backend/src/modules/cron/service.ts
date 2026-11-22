import type { Prisma } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { adapterCollection } from '../../lib/mongo.js';
import { notSet } from '../../lib/prismaFilters.js';
import { prisma } from '../../lib/prisma.js';
import { releaseUploads, UNATTACHED, type R2Context } from '../../lib/r2.js';

export const READ_NOTIFICATION_MAX_AGE_DAYS = 90;
export const UNREAD_NOTIFICATION_MAX_AGE_DAYS = 180;
export const UNATTACHED_UPLOAD_MAX_AGE_HOURS = 24;
export const UPLOADS_PER_RUN = 200;

export interface CronCleanupResult {
  otps: number;
  refreshTokens: number;
  socketEvents: number;
  uploads: number;
  notifications: number;
}

const DAY_MS = 86_400_000;

/**
 * NFR-08 cleanup (ADR-012 §5). Idempotent; safe to run twice. Every "field is set" filter uses
 * `not: null` ($ne) and every "field is empty" filter uses `notSet` (rule 8): a document written
 * without the optional field is "empty", never "set".
 */
export async function runCleanup(ctx: R2Context = {}): Promise<CronCleanupResult> {
  const env = getEnv();
  const now = new Date();

  const otps = (
    await prisma.otp.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { consumedAt: { not: null } }] },
    })
  ).count;

  const refreshTokens = (
    await prisma.refreshToken.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }] },
    })
  ).count;

  const socketCutoff = new Date(now.getTime() - env.SOCKET_ADAPTER_TTL_SECONDS * 1000);
  const socketEvents = (await adapterCollection().deleteMany({ createdAt: { $lt: socketCutoff } }))
    .deletedCount;

  const readCutoff = new Date(now.getTime() - READ_NOTIFICATION_MAX_AGE_DAYS * DAY_MS);
  const unreadCutoff = new Date(now.getTime() - UNREAD_NOTIFICATION_MAX_AGE_DAYS * DAY_MS);
  const readRemoved = await prisma.notification.deleteMany({
    where: { readAt: { not: null }, createdAt: { lt: readCutoff } },
  });
  const unreadRemoved = await prisma.notification.deleteMany({
    where: {
      AND: [notSet<Prisma.NotificationWhereInput>('readAt'), { createdAt: { lt: unreadCutoff } }],
    },
  });
  const notifications = readRemoved.count + unreadRemoved.count;

  const uploadCutoff = new Date(now.getTime() - UNATTACHED_UPLOAD_MAX_AGE_HOURS * 3_600_000);
  const stale = await prisma.upload.findMany({
    where: { AND: [UNATTACHED, { createdAt: { lt: uploadCutoff } }] },
    orderBy: { createdAt: 'asc' },
    take: UPLOADS_PER_RUN,
    select: { key: true },
  });
  let uploads = 0;
  if (stale.length > 0) {
    const keys = stale.map((r) => r.key);
    await releaseUploads(keys, ctx);
    // A row kept because its R2 delete failed is not counted; the next run retries it.
    const remaining = await prisma.upload.count({ where: { key: { in: keys } } });
    uploads = keys.length - remaining;
  }

  return { otps, refreshTokens, socketEvents, uploads, notifications };
}
