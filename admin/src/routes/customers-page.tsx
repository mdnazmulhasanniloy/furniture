import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { customerState, useCustomers, type CustomerStatus } from "@/lib/customers";
import { formatDateTime, formatNumber, toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATE_CLASS: Record<CustomerStatus, string> = {
  active: "bg-success/15 text-success-foreground",
  blocked: "bg-destructive/10 text-destructive", // the existing "blocked" chip (reused, CR-011)
  deleted: "bg-muted text-muted-foreground",
};

export function StateBadge({ state }: { state: CustomerStatus }) {
  const { t } = useTranslation();
  return (
    <span data-testid="customer-state" data-state={state} className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATE_CLASS[state])}>
      {t(`customers.status.${state}`)}
    </span>
  );
}

export function CustomersPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const [draft, setDraft] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  // No filter = active and blocked customers (deleted ones are only listed when asked for).
  const [status, setStatus] = useState<CustomerStatus | undefined>(undefined);
  const list = useCustomers(q, page, status);
  const items = list.data?.items ?? [];
  const meta = list.data?.meta;

  return (
    <section aria-labelledby="customers-title">
      <h1 id="customers-title" className="font-display text-2xl font-semibold">
        {t("customers.title")}
      </h1>
      <form
        role="search"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(draft);
          setPage(1);
        }}
      >
        <div className="min-w-48 flex-1">
          <label htmlFor="cust-search" className="mb-1 block text-sm font-medium">
            {t("customers.search")}
          </label>
          <Input
            id="cust-search"
            type="search"
            maxLength={100}
            placeholder={t("customers.searchPlaceholder")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">
          {t("customers.searchButton")}
        </Button>
        <div role="group" aria-label={t("customers.filter.status")} className="flex items-center gap-1" data-testid="customers-status-filter">
          <span className="me-1 text-sm font-medium">{t("customers.filter.status")}</span>
          {(["active", "blocked", "deleted"] as const).map((st) => (
            <Button
              key={st}
              type="button"
              size="sm"
              variant={status === st ? "default" : "outline"}
              aria-pressed={status === st}
              data-testid={`customers-filter-${st}`}
              onClick={() => {
                setStatus(status === st ? undefined : st);
                setPage(1);
              }}
            >
              {t(`customers.status.${st}`)}
            </Button>
          ))}
        </div>
      </form>
      {list.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("customers.loading")}
        </p>
      )}
      {list.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="customers-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, list.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("customers.retry")}
          </Button>
        </div>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="customers-empty">
          {t("customers.empty")}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="customers-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["name", "email", "orders", "status", "joined"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`customers.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-border" data-testid="customer-row">
                  <td className="px-3 py-2 text-start font-medium">
                    <Link to={`/customers/${encodeURIComponent(c.id)}`} className="text-primary hover:underline" data-testid="customer-link">
                      {c.firstName} {c.lastName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <bdi dir="ltr">{c.email}</bdi>
                  </td>
                  <td className="px-3 py-2 text-start" data-testid="customer-order-count">
                    {formatNumber(c.orderCount ?? 0, locale)}
                  </td>
                  <td className="px-3 py-2 text-start">
                    <StateBadge state={customerState(c)} />
                  </td>
                  <td className="px-3 py-2 text-start text-muted-foreground">
                    {c.createdAt ? formatDateTime(c.createdAt, locale) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.totalPages > 0 && (
        <nav className="mt-3 flex items-center justify-between text-sm" aria-label={t("customers.title")}>
          <span>{t("customers.count", { n: formatNumber(meta.total, locale) })}</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t("customers.prev")}
            </Button>
            <span data-testid="customers-page">
              {t("customers.pageOf", { page: formatNumber(meta.page, locale), total: formatNumber(meta.totalPages, locale) })}
            </span>
            <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
              {t("customers.next")}
            </Button>
          </div>
        </nav>
      )}
    </section>
  );
}
