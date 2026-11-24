import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { formatDateTime, formatNumber, formatPrice, toLocale } from "@/lib/format";
import {
  cancelSchema,
  NEXT_STATUSES,
  NOTE_MAX,
  ORDER_STATUSES,
  STATUS_CLASS,
  useChangeStatus,
  useOrder,
  useSaveNote,
  type AdminOrder,
  type OrderStatus,
} from "@/lib/orders";
import { pickText } from "@/lib/products";
import { cn } from "@/lib/utils";

function CancelDialog({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const change = useChangeStatus(order.id);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const parsed = cancelSchema.safeParse({ note });
    if (!parsed.success) {
      setError(t(parsed.error.issues[0].message));
      return;
    }
    setError(null);
    try {
      await change.mutateAsync({ status: "CANCELLED", note: parsed.data.note });
      onClose();
    } catch (e) {
      setError(transitionError(t, locale, e));
    }
  };
  return (
    <Modal title={t("orders.cancel.title")} onClose={onClose} testId="order-cancel-dialog">
      <p className="mt-3 text-sm">{t("orders.cancel.body")}</p>
      <label htmlFor="cancel-reason" className="mt-3 block text-sm font-medium">
        {t("orders.cancel.reason")}
      </label>
      <textarea
        id="cancel-reason"
        rows={3}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-card p-2 text-sm text-card-foreground"
      />
      <p className="mt-1 text-xs text-muted-foreground">{t("orders.cancel.hint")}</p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="order-cancel-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("orders.cancel.keep")}
        </Button>
        <Button variant="destructive" disabled={change.isPending} data-testid="order-cancel-confirm" onClick={() => void submit()}>
          {t("orders.cancel.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

function transitionError(t: ReturnType<typeof useTranslation>["t"], locale: string, e: unknown) {
  return e instanceof ApiError && e.code === "INVALID_TRANSITION"
    ? t("orders.invalidTransition")
    : errorMessage(t, locale, e);
}

function AdminNote({ order }: { order: AdminOrder }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSaveNote(order.id);
  const [value, setValue] = useState(order.adminNote ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h2 className="font-display text-lg font-semibold">{t("orders.adminNote.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("orders.adminNote.hint")}</p>
      <label htmlFor="admin-note" className="sr-only">
        {t("orders.adminNote.title")}
      </label>
      <textarea
        id="admin-note"
        rows={3}
        maxLength={NOTE_MAX}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        className="mt-2 w-full rounded-md border border-input bg-card p-2 text-sm text-card-foreground"
      />
      {error && (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-1 text-sm text-success-foreground">
          {t("orders.adminNote.saved")}
        </p>
      )}
      <Button
        className="mt-2"
        variant="outline"
        disabled={save.isPending}
        data-testid="admin-note-save"
        onClick={async () => {
          setError(null);
          try {
            // Trimmed; empty clears the note (`null`), per api-spec.
            await save.mutateAsync(value.trim() === "" ? null : value.trim());
            setSaved(true);
          } catch (e) {
            setError(errorMessage(t, locale, e));
          }
        }}
      >
        {t("orders.adminNote.save")}
      </Button>
    </div>
  );
}

export function OrderDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { id } = useParams();
  const q = useOrder(id);
  const change = useChangeStatus(id ?? "");
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const order = q.data;
  useEffect(() => setError(null), [order?.status]);

  if (q.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("orders.loading")}
      </p>
    );
  }
  if (q.isError || !order) {
    return (
      <div className="flex items-center gap-3" data-testid="order-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, q.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          {t("orders.retry")}
        </Button>
      </div>
    );
  }
  const next = NEXT_STATUSES[order.status];
  const reached = new Set(order.statusHistory.map((e) => e.status));
  const customer = order.user ? `${order.user.firstName} ${order.user.lastName}` : "—";
  const row = "flex justify-between gap-4 py-1";

  return (
    <section aria-labelledby="order-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/orders" className="text-sm text-primary hover:underline">
            {t("orders.back")}
          </Link>
          <h1 id="order-title" className="font-display text-2xl font-semibold">
            {t("orders.detailTitle")} <bdi dir="ltr">{order.orderNo}</bdi>
          </h1>
          <p className="text-sm text-muted-foreground">{formatDateTime(order.createdAt, locale)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="order-status"
            className={cn("rounded-full px-3 py-1 text-sm font-medium", STATUS_CLASS[order.status])}
          >
            {t(`orders.status.${order.status}`)}
          </span>
          <Link
            to={`/orders/${encodeURIComponent(order.id)}/invoice`}
            data-testid="order-print-invoice"
            className="inline-flex h-10 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted"
          >
            {t("orders.printInvoice")}
          </Link>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">{t("orders.stepper")}</h2>
        {order.status === "CANCELLED" ? (
          <p className="mt-2 text-sm text-destructive">{t("orders.status.CANCELLED")}</p>
        ) : (
          <ol className="mt-2 flex flex-wrap gap-2" data-testid="order-stepper">
            {ORDER_STATUSES.filter((s) => s !== "CANCELLED").map((s) => (
              <li
                key={s}
                aria-current={s === order.status ? "step" : undefined}
                className={cn(
                  "rounded-full border border-border px-3 py-1 text-xs",
                  reached.has(s) ? "bg-primary/15 text-primary" : "text-muted-foreground",
                  s === order.status && "font-semibold",
                )}
              >
                {t(`orders.status.${s}`)}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="order-actions">
          {next.length === 0 && <p className="text-sm text-muted-foreground">{t("orders.terminal")}</p>}
          {next.map((s: OrderStatus) =>
            s === "CANCELLED" ? (
              <Button key={s} variant="destructive" data-testid="order-action-CANCELLED" onClick={() => setCancelling(true)}>
                {t("orders.action.CANCELLED")}
              </Button>
            ) : (
              <Button
                key={s}
                disabled={change.isPending}
                data-testid={`order-action-${s}`}
                onClick={async () => {
                  setError(null);
                  try {
                    await change.mutateAsync({ status: s });
                  } catch (e) {
                    setError(transitionError(t, locale, e));
                  }
                }}
              >
                {t(`orders.action.${s}`)}
              </Button>
            ),
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive" data-testid="order-transition-error">
            {error}
          </p>
        )}
        <ul className="mt-3 space-y-1 text-sm" data-testid="order-history">
          {order.statusHistory.map((e, i) => (
            <li key={i}>
              {t(`orders.status.${e.status}`)} · <span className="text-muted-foreground">{formatDateTime(e.at, locale)}</span>
              {e.note ? <span className="block text-xs text-muted-foreground">{e.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-display text-lg font-semibold">{t("orders.customer")}</h2>
          <p className="mt-1 text-sm">{customer}</p>
          {order.user && (
            <p className="text-sm text-muted-foreground">
              <bdi dir="ltr">{order.user.email}</bdi>
            </p>
          )}
          <p className="mt-2 text-sm">
            {t("orders.payment.label")}: {t("orders.payment.COD")} · {t(`orders.payment.${order.paymentStatus}`)}
          </p>
          {order.customerNote && (
            <div className="mt-2" data-testid="order-customer-note">
              <p className="text-xs font-medium text-muted-foreground">{t("orders.customerNote")}</p>
              {/* Customer-supplied plain text: rendered as an escaped text node, never as HTML. */}
              <p className="whitespace-pre-wrap text-sm">{order.customerNote}</p>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4" data-testid="order-address">
          <h2 className="font-display text-lg font-semibold">{t("orders.address")}</h2>
          <p className="mt-1 text-sm">{order.address.fullName}</p>
          <p className="text-sm">
            <bdi dir="ltr">{order.address.phone}</bdi>
          </p>
          <p className="text-sm">
            {pickText(order.address.city, locale)}, {order.address.area}
          </p>
          <p className="text-sm">{order.address.street}</p>
          {order.address.notes && <p className="text-sm text-muted-foreground">{order.address.notes}</p>}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="font-display text-lg font-semibold">{t("orders.items")}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm" data-testid="order-items">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["item", "unitPrice", "qty", "lineTotal"] as const).map((k) => (
                  <th key={k} scope="col" className="px-2 py-1 text-start font-medium">
                    {t(`orders.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-2 text-start">
                    {pickText(it.titleSnapshot, locale)}
                    {it.sku && (
                      <span className="block text-xs text-muted-foreground">
                        <bdi dir="ltr">{it.sku}</bdi>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-start">{formatPrice(it.unitPrice, locale)}</td>
                  <td className="px-2 py-2 text-start">{formatNumber(it.qty, locale)}</td>
                  <td className="px-2 py-2 text-start">{formatPrice(it.lineTotal, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-3 ms-auto max-w-xs text-sm" data-testid="order-totals">
          <div className={row}>
            <dt>{t("orders.subtotal")}</dt>
            <dd>{formatPrice(order.subtotal, locale)}</dd>
          </div>
          <div className={row}>
            <dt>{t("orders.deliveryFee")}</dt>
            <dd data-testid="order-delivery-fee">
              {order.deliveryFee === 0 ? t("orders.freeDelivery") : formatPrice(order.deliveryFee, locale)}
            </dd>
          </div>
          {order.vat.vatRate > 0 && (
            <div className={row} data-testid="order-vat">
              <dt>{t("orders.vat", { rate: formatNumber(order.vat.vatRate, locale) })}</dt>
              <dd>{formatPrice(order.vat.vatAmount, locale)}</dd>
            </div>
          )}
          <div className={cn(row, "border-t border-border font-semibold")}>
            <dt>{t("orders.totalLabel")}</dt>
            <dd data-testid="order-total">{formatPrice(order.total, locale)}</dd>
          </div>
        </dl>
      </div>

      <AdminNote key={order.id} order={order} />
      {cancelling && <CancelDialog order={order} onClose={() => setCancelling(false)} />}
    </section>
  );
}
