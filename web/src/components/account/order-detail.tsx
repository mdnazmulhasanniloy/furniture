"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { PhoneText, Price } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cancelOrder, getOrder, type AccountOrder } from "@/lib/account/api";
import { ApiError, apiErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/store";
import { formatDate, formatNumber } from "@/lib/format";
import { pick } from "@/lib/pick";

/** ORD-02 detail (items, address, totals, status timeline) and ORD-03 cancel (PENDING only). */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations("account.orders");
  const ts = useTranslations("orderStatus");
  const tc = useTranslations("cart");
  const tk = useTranslations("checkout");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const user = useAuthStore((s) => s.user);
  const [order, setOrder] = useState<AccountOrder | null>(null);
  const [loadError, setLoadError] = useState<"notFound" | "failed" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState<unknown>(null);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    getOrder(orderId)
      .then((o) => {
        if (!live) return;
        setOrder(o);
        setLoadError(null);
      })
      .catch((e) => live && setLoadError(e instanceof ApiError && e.status === 404 ? "notFound" : "failed"));
    return () => {
      live = false;
    };
  }, [user, orderId, reload]);

  async function cancel() {
    if (busy) return;
    setBusy(true);
    setCancelError(null);
    try {
      setOrder(await cancelOrder(orderId));
      setConfirming(false);
    } catch (e) {
      setCancelError(e);
      setConfirming(false);
      // INVALID_TRANSITION: the status moved on (e.g. an admin confirmed it): show the fresh order.
      if (e instanceof ApiError && e.code === "INVALID_TRANSITION") setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  const back = (
    <Link href="/account/orders" className="text-sm font-medium text-primary underline">{t("back")}</Link>
  );
  if (loadError) {
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{loadError === "notFound" ? t("notFound") : t("loadError")}</p>
        {back}
      </div>
    );
  }
  if (!order) return <p role="status" className="text-sm text-muted-foreground">{tk("loading")}</p>;

  const vat = order.vat;
  const history = [...(order.statusHistory ?? [])].sort((a, b) => +new Date(a.at) - +new Date(b.at));
  return (
    <article className="space-y-6 text-sm" data-testid="order-detail">
      {back}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">
          {t("orderNo")}: <bdi dir="ltr" data-testid="order-no">{order.orderNo}</bdi>
        </h2>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium" data-testid="status-chip">
          {ts(order.status)}
        </span>
      </header>

      {cancelError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-destructive">
          {apiErrorMessage(te as unknown as Parameters<typeof apiErrorMessage>[0], cancelError)}
        </p>
      ) : null}

      <section aria-labelledby="od-timeline">
        <h3 id="od-timeline" className="mb-2 font-medium">{t("timeline")}</h3>
        <ol className="space-y-3 border-s border-border ps-4" data-testid="timeline">
          {history.map((e, i) => (
            <li key={`${e.status}-${e.at}`} className="relative" aria-current={i === history.length - 1 ? "step" : undefined}>
              <span className="absolute -start-[1.3rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
              <span className="font-medium">{ts(e.status)}</span>
              <span className="block text-muted-foreground">{formatDate(e.at, locale, true)}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="od-items">
        <h3 id="od-items" className="mb-2 font-medium">{tk("success.items")}</h3>
        <ul className="divide-y divide-border" data-testid="order-lines">
          {order.items.map((i) => (
            <li key={i.productId} className="flex justify-between gap-3 py-2">
              <span>
                {pick(i.titleSnapshot, locale)}{" "}
                <span className="text-muted-foreground">{tk("success.qty", { qty: formatNumber(i.qty, locale) })}</span>
              </span>
              <Price halalas={i.lineTotal} locale={locale} />
            </li>
          ))}
        </ul>
        <div className="mt-3 space-y-1 border-t border-border pt-3">
          <div className="flex justify-between"><span>{tc("subtotal")}</span><Price halalas={order.subtotal} locale={locale} /></div>
          <div className="flex justify-between">
            <span>{tc("delivery")}</span>
            {order.deliveryFee === 0 ? <span>{tc("freeDelivery")}</span> : <Price halalas={order.deliveryFee} locale={locale} />}
          </div>
          {vat && vat.vatRate > 0 ? (
            <div className="flex justify-between">
              <span>{tc(vat.pricesIncludeVat ? "vatIncluded" : "vatAdded", { rate: formatNumber(vat.vatRate, locale) })}</span>
              <Price halalas={vat.vatAmount} locale={locale} />
            </div>
          ) : null}
          <div className="flex justify-between font-semibold" data-testid="order-total">
            <span>{tc("total")}</span>
            <Price halalas={order.total} locale={locale} />
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-medium">{tk("success.deliverTo")}</h3>
        <p>{order.address.fullName} · <PhoneText value={order.address.phone} /></p>
        <p className="text-muted-foreground">
          {[pick(order.address.city, locale) || order.address.cityCode, order.address.area, order.address.street].join(", ")}
        </p>
      </section>

      <section>
        <h3 className="font-medium">{tk("success.payment")}</h3>
        <p>{tk("cod")}</p>
      </section>

      {order.status === "PENDING" ? (
        <section className="space-y-2" data-testid="cancel-section">
          {confirming ? (
            <>
              <p>{t("cancelConfirm")}</p>
              <div className="flex gap-2">
                <Button variant="destructive" disabled={busy} onClick={() => void cancel()} data-testid="cancel-confirm">
                  {t("cancelYes")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>{t("cancelNo")}</Button>
              </div>
            </>
          ) : (
            <Button variant="outline" onClick={() => setConfirming(true)} data-testid="cancel-order">{t("cancel")}</Button>
          )}
        </section>
      ) : null}
    </article>
  );
}
