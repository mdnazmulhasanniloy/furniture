import { z } from 'zod';

/** NOTIF-03 list query (owner 2026-11-22): page size max 50, default 20 (spec `NotificationLimit`). */
export const listNotificationsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>;
