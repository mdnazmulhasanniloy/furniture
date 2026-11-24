import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import { formatDateTime, formatNumber, formatPrice, toLocale, type Locale } from "@/lib/format";
import { dirOf } from "@/lib/i18n";
import { useOrder } from "@/lib/orders";
import { pickText } from "@/lib/products";

/**
 * Printable invoice (ADM-04). Everything comes from the order snapshot: amounts are shown exactly as
 * stored (never recomputed); the VAT breakdown and registration number appear only when the snapshot
 * `vatRate` > 0; a fee of 0 reads "Free delivery". Marked "Simplified tax invoice" pending B-013.
 * The invoice language (ar | en) defaults to the UI language and can be switched for printing.
 */
export function InvoicePage() {
  const { i18n } = useTranslation();
  const { id } = useParams();
  const q = useOrder(id);
  const [lang, setLang] = useState<Locale | null>(null);
  const ui = toLocale(i18n.language);
  const locale = lang ?? ui;
  const t = i18n.getFixedT(locale);
  const tUi = i18n.getFixedT(ui);

  if (q.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {tUi("orders.loading")}
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(tUi, ui, q.error)}
      </p>
    );
  }
  const o = q.data;
  const vat = o.vat;
  const showVat = vat.vatRate > 0;
  const row = "flex justify-between gap-4 py-1";

  return (
    <section aria-label={tUi("orders.printInvoice")}>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link to={`/orders/${encodeURIComponent(o.id)}`} className="text-sm text-primary hover:underline">
          {tUi("orders.backToOrder")}
        </Link>
        <label htmlFor="invoice-lang" className="text-sm font-medium">
          {tUi("orders.invoice.language")}
        </label>
        <select
          id="invoice-lang"
          value={locale}
          onChange={(e) => setLang(e.target.value as Locale)}
          className="h-10 rounded-md border border-input bg-card px-3 text-sm text-card-foreground"
        >
          <option value="ar">{tUi("common.arabic")}</option>
          <option value="en">{tUi("common.english")}</option>
        </select>
        <Button data-testid="invoice-print" onClick={() => window.print()}>
          {tUi("orders.invoice.print")}
        </Button>
      </div>

      <article
        className="invoice-sheet mx-auto max-w-3xl rounded-lg border border-border bg-card p-6 text-card-foreground"
        lang={locale}
        dir={dirOf(locale)}
        data-testid="invoice"
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <h1 className="font-display text-2xl font-semibold" data-testid="invoice-title">
              {t("orders.invoice.title")}
            </h1>
            <p className="text-sm">{t("app.title")}</p>
          </div>
          <div className="text-sm">
            <p>
              {t("orders.invoice.number")}: <bdi dir="ltr">{o.orderNo}</bdi>
            </p>
            <p>
              {t("orders.invoice.date")}: {formatDateTime(o.createdAt, locale)}
            </p>
            {showVat && vat.registrationNumber && (
              <p data-testid="invoice-vat-reg">
                {t("orders.invoice.vatReg")}: <bdi dir="ltr">{vat.registrationNumber}</bdi>
              </p>
            )}
          </div>
        </header>

        <div className="mt-3 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h2 className="font-semibold">{t("orders.customer")}</h2>
            <p>{o.user ? `${o.user.firstName} ${o.user.lastName}` : "—"}</p>
            {o.user && (
              <p>
                <bdi dir="ltr">{o.user.email}</bdi>
              </p>
            )}
          </div>
          <div data-testid="invoice-address">
            <h2 className="font-semibold">{t("orders.address")}</h2>
            <p>{o.address.fullName}</p>
            <p>
              <bdi dir="ltr">{o.address.phone}</bdi>
            </p>
            <p>
              {pickText(o.address.city, locale)}, {o.address.area}
            </p>
            <p>{o.address.street}</p>
          </div>
        </div>

        <table className="mt-4 w-full text-sm" data-testid="invoice-items">
          <thead>
            <tr className="border-b border-border">
              {(["item", "unitPrice", "qty", "lineTotal"] as const).map((k) => (
                <th key={k} scope="col" className="py-1 text-start font-medium">
                  {t(`orders.col.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.items.map((it, i) => (
              <tr key={i} className="border-b border-border">
                <td className="py-1 text-start">
                  {pickText(it.titleSnapshot, locale)}
                  {it.sku && (
                    <span className="block text-xs">
                      <bdi dir="ltr">{it.sku}</bdi>
                    </span>
                  )}
                </td>
                <td className="py-1 text-start">{formatPrice(it.unitPrice, locale)}</td>
                <td className="py-1 text-start">{formatNumber(it.qty, locale)}</td>
                <td className="py-1 text-start">{formatPrice(it.lineTotal, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ms-auto mt-3 max-w-xs text-sm" data-testid="invoice-totals">
          <div className={row}>
            <dt>{t("orders.subtotal")}</dt>
            <dd>{formatPrice(o.subtotal, locale)}</dd>
          </div>
          <div className={row}>
            <dt>{t("orders.deliveryFee")}</dt>
            <dd data-testid="invoice-delivery-fee">
              {o.deliveryFee === 0 ? t("orders.freeDelivery") : formatPrice(o.deliveryFee, locale)}
            </dd>
          </div>
          {showVat && (
            <div className={row} data-testid="invoice-vat">
              <dt>{t("orders.vat", { rate: formatNumber(vat.vatRate, locale) })}</dt>
              <dd>{formatPrice(vat.vatAmount, locale)}</dd>
            </div>
          )}
          <div className={`${row} border-t border-border font-semibold`}>
            <dt>{t("orders.totalLabel")}</dt>
            <dd data-testid="invoice-total">{formatPrice(o.total, locale)}</dd>
          </div>
        </dl>
        {showVat && (
          <p className="mt-1 text-xs" data-testid="invoice-vat-note">
            {t(vat.pricesIncludeVat ? "orders.invoice.pricesIncludeVat" : "orders.invoice.pricesExcludeVat")}
            {vat.applyToDelivery ? ` ${t("orders.invoice.vatOnDelivery")}` : ""}
          </p>
        )}
        <p className="mt-3 text-sm">
          {t("orders.payment.label")}: {t("orders.payment.COD")} · {t(`orders.payment.${o.paymentStatus}`)}
        </p>
        {o.customerNote && (
          <div className="mt-2 text-sm" data-testid="invoice-customer-note">
            <span className="font-semibold">{t("orders.customerNote")}: </span>
            {/* Customer-supplied plain text, rendered escaped. */}
            <span className="whitespace-pre-wrap">{o.customerNote}</span>
          </div>
        )}
      </article>
    </section>
  );
}
