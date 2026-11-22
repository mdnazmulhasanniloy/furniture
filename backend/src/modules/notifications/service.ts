import type { Notification, Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { notSet } from '../../lib/prismaFilters.js';
import type { ListNotificationsQuery } from './schema.js';

/**
 * NOTIF-03 (T-016): list / mark-one-read / mark-all-read over the caller's own rows only. The rows
 * are the source of truth for delivery (integrations.md): sockets are best-effort on top.
 */

const OBJECT_ID = /^[a-f0-9]{24}$/;

/** Foreign, unknown and malformed ids are the same 404: ownership is never revealed (T-007 rule). */
const notFound = () => new AppError(404, 'NOT_FOUND', 'Notification not found');

/** Unread = `readAt` explicit null OR missing (rule 8; consumers write explicit null anyway). */
export const UNREAD: Prisma.NotificationWhereInput =
  notSet<Prisma.NotificationWhereInput>('readAt');

/** Spec `Notification` shape — also the `notification:new` socket payload (integrations.md). */
export function toNotification(n: Notification) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link ?? null,
    data: n.data ?? null,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

export type NotificationResponse = ReturnType<typeof toNotification>;

export async function listMyNotifications(userId: string, query: ListNotificationsQuery) {
  const where = { userId };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, ...UNREAD } }),
  ]);
  return {
    items: rows.map(toNotification),
    meta: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
    },
    unread,
  };
}

/**
 * Idempotent (owner 2026-11-22): one conditional write scoped to the owner's unread row. A miss on
 * an EXISTING own row means it was already read -> 204 again, `readAt` untouched; no row -> 404.
 */
export async function markRead(userId: string, id: string): Promise<void> {
  if (!OBJECT_ID.test(id)) throw notFound();
  const res = await prisma.notification.updateMany({
    where: { id, userId, ...UNREAD },
    data: { readAt: new Date() },
  });
  if (res.count === 1) return;
  const exists = await prisma.notification.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!exists) throw notFound();
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, ...UNREAD },
    data: { readAt: new Date() },
  });
}
