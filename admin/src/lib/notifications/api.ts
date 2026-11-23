import { api } from "@/lib/api/client";
import type { LocalizedText } from "@/lib/products";

// Notifications API (ADM-10, NOTIF-03): api-spec.yaml #/notifications. Admins see their own
// NEW_ORDER rows through the same endpoints as customers.

export type AppNotification = {
  id: string;
  type: "ORDER_PLACED" | "ORDER_STATUS" | "NEW_ORDER" | "SYSTEM";
  title: LocalizedText;
  body: LocalizedText;
  link?: string | null;
  data?: { orderId?: string; orderNo?: string; status?: string } | null;
  readAt?: string | null;
  createdAt: string;
};

export type NotificationPage = {
  items: AppNotification[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  unread: number;
};

export const PAGE_LIMIT = 20;

export const listNotifications = (page = 1, limit = PAGE_LIMIT) =>
  api.get<NotificationPage>(`/notifications?page=${page}&limit=${limit}`);

export const markNotificationRead = (id: string) =>
  api.patch<void>(`/notifications/${encodeURIComponent(id)}/read`);

export const markAllNotificationsRead = () => api.post<void>("/notifications/read-all");

/** `data.orderId` is the authoritative navigation payload (api-spec); `link` is only a logical path. */
export function notificationHref(n: AppNotification): string | null {
  const id = n.data?.orderId;
  return typeof id === "string" && /^[0-9a-f]{24}$/i.test(id) ? `/orders/${id}` : null;
}
