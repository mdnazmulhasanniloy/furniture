import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { useBlockCustomer, useCustomer, type Customer } from "@/lib/customers";
import { formatDateTime, formatNumber, formatPrice, toLocale } from "@/lib/format";
import { STATUS_CLASS } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { StateBadge } from "@/routes/customers-page";

function BlockControl({ user }: { user: Customer }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const block = useBlockCustomer(user.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (isBlocked: boolean) => {
    setError(null);
    try {
      await block.mutateAsync(isBlocked);
      setConfirming(false);
    } catch (e) {
      setError(errorMessage(t, locale, e));
      if (e instanceof ApiError && e.code === "NOT_FOUND") setConfirming(false);
    }
  };
  return (
    <div>
      {user.isBlocked ? (
        <Button variant="outline" disabled={block.isPending} data-testid="customer-unblock" onClick={() => void send(false)}>
          {t("customers.unblock")}
        </Button>
      ) : (
        <Button
          variant="destructive"
          data-testid="customer-block"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          {t("customers.block")}
        </Button>
      )}
      {error && !confirming && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="customer-block-error">
          {error}
        </p>
      )}
      {confirming && (
        <Modal title={t("customers.blockDialog.title")} onClose={() => setConfirming(false)} testId="customer-block-dialog">
          <p className="mt-3 text-sm">{t("customers.blockDialog.body")}</p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive" data-testid="customer-block-error">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              {t("customers.blockDialog.cancel")}
            </Button>
            <Button variant="destructive" disabled={block.isPending} data-testid="customer-block-confirm" onClick={() => void send(true)}>
              {t("customers.blockDialog.confirm")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CustomerDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const q = useCustomer(id, page);

  if (q.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        {t("customers.loading")}
      </p>
    );
  if (q.isError)
    return (
      <div className="flex items-center gap-3" data-testid="customer-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, q.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          {t("customers.retry")}
        </Button>
      </div>
    );
  const { user, orders, meta } = q.data;
  const info: [string, React.ReactNode][] = [
    [t("customers.col.email"), <bdi key="e" dir="ltr">{user.email}</bdi>],
    [t("customers.phone"), user.phone ? <bdi key="p" dir="ltr">{user.phone}</bdi> : "—"],
    [t("customers.verified"), user.isVerified ? t("customers.yes") : t("customers.no")],
    [t("customers.locale"), user.preferredLocale === "en" ? "English" : "العربية"],
    [t("customers.col.joined"), user.createdAt ? formatDateTime(user.createdAt, locale) : "—"],
  ];
  return (
    <section aria-labelledby="customer-title">
      <Link to="/customers" className="text-sm text-primary hover:underline">
        {t("customers.back")}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="customer-title" className="font-display text-2xl font-semibold">
            {user.firstName} {user.lastName}
          </h1>
          <div className="mt-1">
            <StateBadge blocked={user.isBlocked} />
          </div>
        </div>
        <BlockControl user={user} />
      </div>
      <dl className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2" data-testid="customer-info">
        {info.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-6 font-display text-lg font-semibold">{t("customers.ordersTitle")}</h2>
      {orders.length === 0 ? (
        <p className="mt-2 text-muted-foreground" data-testid="customer-orders-empty">
          {t("customers.noOrders")}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="customer-orders">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["order", "status", "total", "placed"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`orders.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border" data-testid="customer-order-row">
                  <td className="px-3 py-2 text-start font-medium">
                    <Link to={`/orders/${encodeURIComponent(o.id)}`} className="text-primary hover:underline" data-testid="customer-order-link">
                      <bdi dir="ltr">{o.orderNo}</bdi>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[o.status])}>
                      {t(`orders.status.${o.status}`)}
                    </span>
                  </td>
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
      {meta.totalPages > 1 && (
        <nav className="mt-3 flex items-center justify-end gap-2 text-sm" aria-label={t("customers.ordersTitle")}>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("customers.prev")}
          </Button>
          <span data-testid="customer-orders-page">
            {t("customers.pageOf", { page: formatNumber(meta.page, locale), total: formatNumber(meta.totalPages, locale) })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("customers.next")}
          </Button>
        </nav>
      )}
    </section>
  );
}
