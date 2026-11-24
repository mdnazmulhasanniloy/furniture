import { Bell, Volume2, VolumeX, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";
import { ADMIN_ROLE } from "@/lib/auth/flows";
import { formatNumber, toLocale } from "@/lib/format";
import { notificationHref } from "@/lib/notifications/api";
import { startLiveNotifications } from "@/lib/notifications/socket";
import {
  dismissToast,
  onNewOrder,
  playChime,
  resetNotifications,
  setSoundEnabled,
  soundEnabled,
  useNotificationStore,
  type Toast,
} from "@/lib/notifications/store";

const AUTO_DISMISS_MS = 6000;
export const pickText = (t: { en: string; ar: string }, lang: string) => (lang === "en" ? t.en : t.ar) || t.en || t.ar;

/** Opens the socket for a signed-in ADMIN only (ADM-10); closes it and clears state on logout. */
export function NotificationsSync() {
  const { status, user } = useAuth();
  const userId = user?.id;
  const role = user?.role;
  useEffect(() => {
    if (status !== "authenticated" || role !== ADMIN_ROLE) return;
    const stop = startLiveNotifications();
    return () => {
      stop();
      resetNotifications();
    };
  }, [status, userId, role]);
  return null;
}

/** Bell with unread badge (links to the list) and the sound toggle (NOTIF-02). */
export function BellActions() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { unread } = useNotificationStore();
  const [sound, setSound] = useState(soundEnabled);
  const label = unread > 0 ? t("notifications.bellUnread", { n: formatNumber(unread, locale) }) : t("shell.notifications");
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t(sound ? "notifications.soundOn" : "notifications.soundOff")}
        aria-pressed={sound}
        data-testid="sound-toggle"
        onClick={() => {
          setSound(!sound);
          setSoundEnabled(!sound);
        }}
      >
        {sound ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      </Button>
      <Link
        to="/notifications"
        aria-label={label}
        data-testid="bell"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span
            data-testid="notifications-count"
            className="absolute -end-1 -top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
          >
            {unread > 99 ? "99+" : formatNumber(unread, locale)}
          </span>
        )}
      </Link>
    </>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const { t, i18n } = useTranslation();
  useEffect(() => {
    const id = setTimeout(() => dismissToast(toast.key), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast.key]);
  const close = () => dismissToast(toast.key);
  const href = toast.kind === "single" ? notificationHref(toast.notification) : null;
  return (
    <li
      data-testid="notification-toast"
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-md"
    >
      <div className="min-w-0 flex-1 text-sm">
        {toast.kind === "group" ? (
          <Link to="/notifications" onClick={close} className="font-medium hover:underline">
            {t("notifications.grouped", { count: toast.count })}
          </Link>
        ) : (
          <>
            {href ? (
              <Link to={href} onClick={close} className="font-medium hover:underline">
                {pickText(toast.notification.title, i18n.language)}
              </Link>
            ) : (
              <p className="font-medium">{pickText(toast.notification.title, i18n.language)}</p>
            )}
            <p className="text-muted-foreground">{pickText(toast.notification.body, i18n.language)}</p>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={t("notifications.dismiss")}
        onClick={close}
        className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
  );
}

/** Toast stack, bottom end corner; also plays the optional chime for a new order (NOTIF-02). */
export function NotificationToaster() {
  const { toasts } = useNotificationStore();
  useEffect(() => {
    onNewOrder(() => {
      if (soundEnabled()) playChime();
    });
    return () => onNewOrder(null);
  }, []);
  return (
    <ul
      role="status"
      aria-live="polite"
      data-testid="notification-toaster"
      className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 [&>li]:pointer-events-auto"
    >
      {toasts.slice(-4).map((x) => (
        <ToastItem key={x.key} toast={x} />
      ))}
    </ul>
  );
}
