import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import { formatDateTime, formatNumber, formatPrice, toLocale, type Locale } from "@/lib/format";
import { dirOf } from "@/lib/i18n";
import { useOrder } from "@/lib/orders";
import { pickText } from "@/lib/products";
import { useSettings } from "@/lib/settings";
import { phase1QrPayload } from "@/lib/zatca";

/**
 * Printable invoice (ADM-04). Every amount comes from the order snapshot and is shown exactly as
 * stored, never recomputed; a fee of 0 reads "Free delivery". The invoice language (ar | en) defaults
 * to the UI language and can be switched for printing.
 *
 * Owner 2026-11-24 (A6), closes the Phase 1 half of B-013: the seller is the store name from settings
 * (ADM-09), and the VAT registration number on the snapshot decides what kind of document this is.
 * Without it the sheet is a plain "Invoice" with no VAT line and no QR; with it, it is a simplified tax
 * invoice carrying the seller name, the VAT number, the issue date and time, the line totals, the VAT
 * amount, the total including VAT and the ZATCA Phase 1 QR. ZATCA Phase 2 (e-invoicing integration) is
 * launch blocker B-041. The VAT line also shows whenever the snapshot rate is above 0, so a charged VAT
 * can never be hidden by a registration number that was not configured at the time.
 */
export function InvoicePage() {
  const { i18n } = useTranslation();
  const { id } = useParams();
  const q = useOrder(id);
  const settings = useSettings();
  const [lang, setLang] = useState<Locale | null>(null);
  const ui = toLocale(i18n.language);
  const locale = lang ?? ui;
  const t = i18n.getFixedT(locale);
  const tUi = i18n.getFixedT(ui);

  if (q.isPending || settings.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {tUi("orders.loading")}
      </p>
    );
  }
  if (q.isError || !q.data || settings.isError || !settings.data) {
    return (
      <p role="alert" className="text-destructive">
        {errorMessage(tUi, ui, q.error ?? settings.error)}
      </p>
    );
  }
  const o = q.data;
  const vat = o.vat;
  // A simplified tax invoice needs a seller VAT number; without one this is an ordinary invoice.
  const taxInvoice = !!vat.registrationNumber;
  const showVat = taxInvoice || vat.vatRate > 0;
  const sellerName = pickText(settings.data.storeName, locale);
  const row = "flex justify-between gap-4 py-1";
  const qrPayload = taxInvoice
    ? phase1QrPayload({
        sellerName,
        vatNumber: vat.registrationNumber!,
        issuedAt: o.createdAt,
        totalWithVat: o.total,
        vatTotal: vat.vatAmount,
      })
    : null;

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
              {t(taxInvoice ? "orders.invoice.titleTax" : "orders.invoice.title")}
            </h1>
            <p className="text-sm" data-testid="invoice-seller">
              {t("orders.invoice.seller")}: {sellerName}
            </p>
          </div>
          <div className="text-sm">
            <p>
              {t("orders.invoice.number")}: <bdi dir="ltr">{o.orderNo}</bdi>
            </p>
            <p data-testid="invoice-date">
              {t("orders.invoice.date")}: {formatDateTime(o.createdAt, locale)}
            </p>
            {vat.registrationNumber && (
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
            <dt>{t(taxInvoice ? "orders.invoice.totalInclVat" : "orders.totalLabel")}</dt>
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
        {qrPayload && (
          <figure className="mt-3" data-testid="invoice-qr">
            {/* ZATCA Phase 1: the QR carries the base64 TLV of seller, VAT number, timestamp, total and VAT. */}
            <QrCode value={qrPayload} label={t("orders.invoice.qr")} testId="invoice-qr-svg" size={128} />
            <figcaption className="mt-1 text-xs text-muted-foreground">{t("orders.invoice.qr")}</figcaption>
          </figure>
        )}
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
