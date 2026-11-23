import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { pickText } from "@/components/notifications/live";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import { formatDateTime, formatNumber, toLocale } from "@/lib/format";
import {
  listNotifications,
  notificationHref,
  PAGE_LIMIT,
  type AppNotification,
  type NotificationPage,
} from "@/lib/notifications/api";
import { markAllRead, markRead, useNotificationStore } from "@/lib/notifications/store";
import { cn } from "@/lib/utils";

/** ADM-10 / NOTIF-03: persistent paginated list; mark one / all read; a row opens its order. */
export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const { version } = useNotificationStore();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [actionFailed, setActionFailed] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    listNotifications(page, PAGE_LIMIT)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(null);
      })
      .catch((e) => live && setFailed(e));
    return () => {
      live = false;
    };
  }, [page, attempt, version]);

  const open = async (n: AppNotification) => {
    const href = notificationHref(n);
    setActionFailed(null);
    if (!n.readAt) {
      try {
        await markRead(n.id);
      } catch (e) {
        setActionFailed(e);
        return;
      }
    }
    if (href) navigate(href);
  };
  const readAll = async () => {
    setActionFailed(null);
    try {
      await markAllRead();
    } catch (e) {
      setActionFailed(e);
    }
  };

  if (failed) {
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{errorMessage(t, i18n.language, failed)}</p>
        <Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>
          {t("notifications.retry")}
        </Button>
      </div>
    );
  }
  if (!data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {t("notifications.loading")}
      </p>
    );

  const totalPages = Math.max(1, data.meta?.totalPages ?? 1);
  return (
    <section aria-labelledby="notif-title" className="space-y-4" data-testid="notifications-list">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="notif-title" className="font-display text-2xl font-semibold">
          {t("notifications.title")}
        </h1>
        <Button variant="outline" size="sm" disabled={data.unread === 0} onClick={() => void readAll()}>
          {t("notifications.markAllRead")}
        </Button>
      </div>
      {actionFailed ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(t, i18n.language, actionFailed)}
        </p>
      ) : null}
      {data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("notifications.empty")}</p>
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
                    "block w-full rounded-lg border border-border p-4 text-start hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                    unreadRow ? "bg-secondary" : "bg-card",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {unreadRow ? (
                      <>
                        <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                        <span className="sr-only">{t("notifications.unread")}</span>
                      </>
                    ) : null}
                    <span className="font-medium">{pickText(n.title, i18n.language)}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{pickText(n.body, i18n.language)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{formatDateTime(n.createdAt, locale)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("notifications.previous")}
          </Button>
          <span>
            {t("notifications.pageOf", { page: formatNumber(page, locale), total: formatNumber(totalPages, locale) })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("notifications.next")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
