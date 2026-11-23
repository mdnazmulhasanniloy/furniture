"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";

import { Link } from "@/i18n/navigation";
import { notificationHref } from "@/lib/notifications/api";
import { dismissToast, useNotificationStore, type Toast } from "@/lib/notifications/store";
import { pick } from "@/lib/pick";

const AUTO_DISMISS_MS = 6000;

function ToastItem({ toast }: { toast: Toast }) {
  const t = useTranslations("notifications");
  const locale = useLocale();
  useEffect(() => {
    const id = setTimeout(() => dismissToast(toast.key), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast.key]);

  const href = toast.kind === "single" ? notificationHref(toast.notification) : null;
  const close = () => dismissToast(toast.key);
  return (
    <li
      data-testid="notification-toast"
      className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-card-foreground shadow-[var(--shadow-soft)]"
    >
      <div className="min-w-0 flex-1 text-sm">
        {toast.kind === "group" ? (
          <Link href="/account/notifications" onClick={close} className="font-medium hover:underline">
            {t("grouped", { count: toast.count })}
          </Link>
        ) : (
          <>
            {href ? (
              <Link href={href} onClick={close} className="font-medium hover:underline">
                {pick(toast.notification.title, locale)}
              </Link>
            ) : (
              <p className="font-medium">{pick(toast.notification.title, locale)}</p>
            )}
            <p className="text-muted-foreground">{pick(toast.notification.body, locale)}</p>
          </>
        )}
      </div>
      <button
        type="button"
        aria-label={t("dismiss")}
        onClick={close}
        className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X aria-hidden className="size-4" />
      </button>
    </li>
  );
}

/** Toast stack (NOTIF-01). Bottom end corner; polite live region so screen readers hear it. */
export function NotificationToaster() {
  const toasts = useNotificationStore((s) => s.toasts);
  return (
    <ul
      role="status"
      aria-live="polite"
      data-testid="notification-toaster"
      className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 [&>li]:pointer-events-auto"
    >
      {toasts.slice(-4).map((x) => (
        <ToastItem key={x.key} toast={x} />
      ))}
    </ul>
  );
}
