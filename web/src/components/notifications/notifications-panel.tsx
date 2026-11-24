"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { useAuthStore } from "@/lib/auth/store";
import { formatDate, formatNumber } from "@/lib/format";
import {
  listNotifications,
  notificationHref,
  PAGE_LIMIT,
  type AppNotification,
  type NotificationPage,
} from "@/lib/notifications/api";
import { markAllRead, markRead, useNotificationStore } from "@/lib/notifications/store";
import { pick } from "@/lib/pick";
import { cn } from "@/lib/utils";

/** NOTIF-03: persistent, paginated list; mark one / all as read; click goes to the related order. */
export function NotificationsPanel() {
  const t = useTranslations("notifications");
  const tc = useTranslations("checkout");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const version = useNotificationStore((s) => s.version);
  const unread = useNotificationStore((s) => s.unread);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    listNotifications(page, PAGE_LIMIT)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [user, page, attempt, version]);

  const open = async (n: AppNotification) => {
    const href = notificationHref(n);
    setActionFailed(false);
    if (!n.readAt) {
      try {
        await markRead(n.id);
      } catch {
        setActionFailed(true);
        return;
      }
    }
    if (href) router.push(href);
  };

  const readAll = async () => {
    setActionFailed(false);
    try {
      await markAllRead();
    } catch {
      setActionFailed(true);
    }
  };

  if (failed) {
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{t("loadError")}</p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{tc("retry")}</Button>
      </div>
    );
  }
  if (!data) return <p role="status" className="text-sm text-muted-foreground">{tc("loading")}</p>;

  const totalPages = Math.max(1, data.meta?.totalPages ?? 1);
  return (
    <section aria-labelledby="notif-h" className="space-y-4" data-testid="notifications-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="notif-h" className="font-display text-lg font-semibold">{t("title")}</h2>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => void readAll()}>
          {t("markAllRead")}
        </Button>
      </div>
      {actionFailed ? <p role="alert" className="text-sm text-destructive">{t("actionError")}</p> : null}
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((n) => {
            const unreadRow = !n.readAt;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  data-testid="notification-row"
                  data-unread={unreadRow ? "true" : "false"}
                  onClick={() => void open(n)}
                  className={cn(
                    "block w-full rounded-lg border border-border p-4 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    unreadRow ? "bg-secondary" : "bg-card",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {unreadRow ? (
                      <>
                        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                        <span className="sr-only">{t("unread")}</span>
                      </>
                    ) : null}
                    <span className="font-medium">{pick(n.title, locale)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{pick(n.body, locale)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{formatDate(n.createdAt, locale, true)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("previous")}</Button>
          <span>{t("pageOf", { page: formatNumber(page, locale), total: formatNumber(totalPages, locale) })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t("next")}</Button>
        </div>
      ) : null}
    </section>
  );
}
