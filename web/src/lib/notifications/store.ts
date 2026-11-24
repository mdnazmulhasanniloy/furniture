import { create } from "zustand";

import { listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from "./api";

// NOTIF-01 / ADR-012: the bell count and the toasts. The Notification row in the API is the
// source of truth; the socket only speeds things up. Every connect re-fetches page 1.

export type Toast =
  | { key: string; kind: "single"; notification: AppNotification }
  | { key: string; kind: "group"; count: number };

type State = {
  unread: number;
  items: AppNotification[];
  /** Bumped on every change so open lists can re-fetch their page. */
  version: number;
  toasts: Toast[];
};

export const GROUP_AFTER = 3;

export const useNotificationStore = create<State>(() => ({ unread: 0, items: [], version: 0, toasts: [] }));

let known = new Set<string>();
let baseline = false;
let seq = 0;

const bump = () => useNotificationStore.setState((s) => ({ version: s.version + 1 }));

function pushToasts(fresh: AppNotification[]) {
  if (fresh.length === 0) return;
  const toasts: Toast[] =
    fresh.length > GROUP_AFTER
      ? [{ key: `t${++seq}`, kind: "group", count: fresh.length }]
      : fresh.map((notification) => ({ key: `t${++seq}`, kind: "single" as const, notification }));
  useNotificationStore.setState((s) => ({ toasts: [...s.toasts, ...toasts] }));
}

/** Re-fetch page 1 (after every socket connect and after mark-read). New unread rows get a toast. */
export async function refreshNotifications(): Promise<void> {
  const page = await listNotifications(1);
  const fresh = baseline ? page.items.filter((n) => !known.has(n.id) && !n.readAt) : [];
  for (const n of page.items) known.add(n.id);
  baseline = true;
  useNotificationStore.setState({ items: page.items, unread: page.unread });
  pushToasts(fresh);
  bump();
}

/** `notification:new` payload: the recipient's own row (api-spec Notification). */
export function receiveNotification(n: AppNotification): void {
  if (!n || typeof n.id !== "string" || known.has(n.id)) return;
  known.add(n.id);
  useNotificationStore.setState((s) => ({
    items: [n, ...s.items].slice(0, 20),
    unread: s.unread + (n.readAt ? 0 : 1),
  }));
  pushToasts([n]);
  bump();
}

export async function markRead(id: string): Promise<void> {
  await markNotificationRead(id);
  await refreshNotifications();
}

export async function markAllRead(): Promise<void> {
  await markAllNotificationsRead();
  await refreshNotifications();
}

export function dismissToast(key: string): void {
  useNotificationStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) }));
}

export function resetNotifications(): void {
  known = new Set();
  baseline = false;
  useNotificationStore.setState({ unread: 0, items: [], toasts: [], version: 0 });
}
