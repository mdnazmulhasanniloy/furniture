import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { formatDateTime, formatNumber, formatPrice, toLocale } from "@/lib/format";
import { ORDER_STATUSES, STATUS_CLASS, useOrders, type OrderQuery } from "@/lib/orders";
import { cn } from "@/lib/utils";

export function OrdersPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const [draft, setDraft] = useState({ q: "", from: "", to: "" });
  const [query, setQuery] = useState<OrderQuery>({ status: "", q: "", from: "", to: "", page: 1 });
  const list = useOrders(query);
  const items = list.data?.items ?? [];
  const meta = list.data?.meta;
  const set = (p: Partial<OrderQuery>) => setQuery((q) => ({ ...q, page: 1, ...p }));

  return (
    <section aria-labelledby="orders-title">
      <h1 id="orders-title" className="font-display text-2xl font-semibold">
        {t("orders.title")}
      </h1>
      <div role="tablist" aria-label={t("orders.filterStatus")} className="mt-4 flex flex-wrap gap-2">
        {(["", ...ORDER_STATUSES] as const).map((s) => (
          <button
            key={s || "all"}
            type="button"
            role="tab"
            aria-selected={query.status === s}
            data-testid={`orders-tab-${s || "ALL"}`}
            onClick={() => set({ status: s })}
            className={cn(
              "h-9 rounded-full border border-border px-3 text-sm",
              query.status === s ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground hover:bg-muted",
            )}
          >
            {s ? t(`orders.status.${s}`) : t("orders.all")}
          </button>
        ))}
      </div>
      <form
        role="search"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: draft.q, from: draft.from, to: draft.to });
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="ord-search" className="mb-1 block text-sm font-medium">
            {t("orders.search")}
          </label>
          <Input
            id="ord-search"
            type="search"
            maxLength={100}
            placeholder={t("orders.searchPlaceholder")}
            value={draft.q}
            onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
          />
        </div>
        <div>
          <label htmlFor="ord-from" className="mb-1 block text-sm font-medium">
            {t("orders.from")}
          </label>
          <Input id="ord-from" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
        </div>
        <div>
          <label htmlFor="ord-to" className="mb-1 block text-sm font-medium">
            {t("orders.to")}
          </label>
          <Input id="ord-to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
        </div>
        <Button type="submit" variant="outline">
          {t("orders.searchButton")}
        </Button>
      </form>
      {list.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("orders.loading")}
        </p>
      )}
      {list.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="orders-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, list.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("orders.retry")}
          </Button>
        </div>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="orders-empty">
          {t("orders.empty")}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="orders-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["order", "customer", "status", "payment", "total", "placed"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`orders.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id} className="border-t border-border" data-testid="order-row">
                  <td className="px-3 py-2 text-start font-medium">
                    <Link to={`/orders/${encodeURIComponent(o.id)}`} className="text-primary hover:underline" data-testid="order-link">
                      <bdi dir="ltr">{o.orderNo}</bdi>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-start">{o.user ? `${o.user.firstName} ${o.user.lastName}` : "—"}</td>
                  <td className="px-3 py-2 text-start">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[o.status])}>
                      {t(`orders.status.${o.status}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-start">{t(`orders.payment.${o.paymentStatus}`)}</td>
                  <td className="px-3 py-2 text-start">
                    <bdi>{formatPrice(o.total, locale)}</bdi>
                  </td>
                  <td className="px-3 py-2 text-start text-muted-foreground">{formatDateTime(o.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.totalPages > 0 && (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label={t("orders.title")}>
          <span>{t("orders.count", { n: formatNumber(meta.total, locale) })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={query.page <= 1} onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}>
              {t("orders.prev")}
            </Button>
            <span data-testid="orders-page">
              {t("orders.pageOf", { page: formatNumber(meta.page, locale), total: formatNumber(meta.totalPages, locale) })}
            </span>
            <Button variant="outline" size="sm" disabled={query.page >= meta.totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
              {t("orders.next")}
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
