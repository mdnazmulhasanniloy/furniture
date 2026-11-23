"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Price } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { listOrders, type OrderPage } from "@/lib/account/api";
import { useAuthStore } from "@/lib/auth/store";
import { formatDate, formatNumber } from "@/lib/format";

const PAGE_SIZE = 10;

/** ORD-02: my orders, newest first, with a status chip. */
export function OrdersList() {
  const t = useTranslations("account.orders");
  const ts = useTranslations("orderStatus");
  const tc = useTranslations("checkout");
  const locale = useLocale() as Locale;
  const user = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<OrderPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    listOrders(page, PAGE_SIZE)
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [user, page, attempt]);

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
    <section aria-labelledby="orders-h" className="space-y-4" data-testid="orders-list">
      <h2 id="orders-h" className="font-display text-lg font-semibold">{t("title")}</h2>
      {data.items.length === 0 ? (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{t("empty")}</p>
          <Link href="/shop" className="font-medium text-primary underline">{tc("continueShopping")}</Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.items.map((o) => (
            <li key={o.id}>
              <Link
                href={`/account/orders/${o.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted"
                data-testid="order-row"
              >
                <span className="space-y-1">
                  <bdi className="block font-medium" dir="ltr">{o.orderNo}</bdi>
                  <span className="block text-sm text-muted-foreground">
                    {o.createdAt ? formatDate(o.createdAt, locale) : null}
                    {" · "}
                    {t("itemsCount", { count: o.items.reduce((n, i) => n + i.qty, 0) })}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium" data-testid="status-chip">
                    {ts(o.status)}
                  </span>
                  <span className="text-sm font-semibold"><Price halalas={o.total} locale={locale} /></span>
                </span>
              </Link>
            </li>
          ))}
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
