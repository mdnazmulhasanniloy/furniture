import { useSyncExternalStore } from "react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from "./api";

// ADM-10 / NOTIF-02 / ADR-012: bell count + toasts. The Notification row in the API is the
// source of truth; the socket only speeds things up. Every connect re-fetches page 1.

export type Toast =
  | { key: string; kind: "single"; notification: AppNotification }
  | { key: string; kind: "group"; count: number };

export type NotificationState = {
  unread: number;
  items: AppNotification[];
  /** Bumped on every change so open lists can re-fetch their page. */
  version: number;
  toasts: Toast[];
};

export const GROUP_AFTER = 3;
export const SOUND_KEY = "fx_admin_notif_sound"; // non-sensitive UI preference

const initial = (): NotificationState => ({ unread: 0, items: [], version: 0, toasts: [] });
let state = initial();
const listeners = new Set<() => void>();
const set = (fn: (s: NotificationState) => Partial<NotificationState>) => {
  state = { ...state, ...fn(state) };
  listeners.forEach((l) => l());
};

export const notificationStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
export const useNotificationStore = () =>
  useSyncExternalStore(notificationStore.subscribe, notificationStore.get, notificationStore.get);

let known = new Set<string>();
let baseline = false;
let seq = 0;
let soundHook: (() => void) | null = null;

/** Registered by the toaster: called once per batch that contains a new order. */
export function onNewOrder(fn: (() => void) | null) {
  soundHook = fn;
}

const bump = () => set((s) => ({ version: s.version + 1 }));

function pushToasts(fresh: AppNotification[]) {
  if (fresh.length === 0) return;
  const toasts: Toast[] =
    fresh.length > GROUP_AFTER
      ? [{ key: `t${++seq}`, kind: "group", count: fresh.length }]
      : fresh.map((notification) => ({ key: `t${++seq}`, kind: "single" as const, notification }));
  set((s) => ({ toasts: [...s.toasts, ...toasts] }));
  if (fresh.some((n) => n.type === "NEW_ORDER")) soundHook?.();
}

/** Re-fetch page 1 (after every socket connect and after mark-read). New unread rows get a toast. */
export async function refreshNotifications(): Promise<void> {
  const page = await listNotifications(1);
  const fresh = baseline ? page.items.filter((n) => !known.has(n.id) && !n.readAt) : [];
  for (const n of page.items) known.add(n.id);
  baseline = true;
  set(() => ({ items: page.items, unread: page.unread }));
  pushToasts(fresh);
  bump();
}

/** `notification:new` payload: the recipient's own row (api-spec Notification). */
export function receiveNotification(n: AppNotification): void {
  if (!n || typeof n.id !== "string" || known.has(n.id)) return;
  known.add(n.id);
  set((s) => ({ items: [n, ...s.items].slice(0, 20), unread: s.unread + (n.readAt ? 0 : 1) }));
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
  set((s) => ({ toasts: s.toasts.filter((t) => t.key !== key) }));
}

export function resetNotifications(): void {
  known = new Set();
  baseline = false;
  state = initial();
  listeners.forEach((l) => l());
}

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== "0"; // default on
  } catch {
    return true;
  }
}
export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

type AudioCtor = typeof AudioContext;
let chimeImpl: (() => void) | null = null;
/** Test seam. */
export function configureChime(fn: (() => void) | null) {
  chimeImpl = fn;
}

/** Short two-tone chime via Web Audio (no asset file). Silent when unavailable or blocked. */
export function playChime(): void {
  if (chimeImpl) return chimeImpl();
  try {
    const Ctx: AudioCtor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.15);
      gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.15 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.15 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.15);
      osc.stop(now + i * 0.15 + 0.32);
    });
    setTimeout(() => void ctx.close().catch(() => undefined), 800);
  } catch {
    /* autoplay policy or no audio: the toast is enough */
  }
}
