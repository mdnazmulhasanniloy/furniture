"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { PhoneText, Price } from "@/components/format";
import { Link, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { useAuthStore } from "@/lib/auth/store";
import { fetchOrder, type Order } from "@/lib/checkout/api";
import { formatNumber } from "@/lib/format";
import { pick } from "@/lib/pick";

/** ORD-01 success page: the order number and every amount come from `GET /orders/{id}`. */
export function SuccessPage({ orderId }: { orderId: string | null }) {
  const t = useTranslations("checkout");
  const tc = useTranslations("cart");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const [order, setOrder] = useState<Order | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated" || !orderId) return;
    let live = true;
    fetchOrder(orderId)
      .then((o) => live && setOrder(o))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [status, orderId]);

  const vat = order?.vat;
  return (
    <main className="mx-auto max-w-2xl px-4 py-10" data-testid="checkout-success">
      <h1 className="font-display text-2xl font-semibold">{t("success.title")}</h1>
      {failed || !orderId ? (
        <p role="alert" className="mt-4 text-sm text-destructive">{t("success.loadError")}</p>
      ) : !order ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">{t("loading")}</p>
      ) : (
        <div className="mt-4 space-y-6 text-sm">
          <p>
            {t("success.orderNo")}: <bdi className="font-semibold" data-testid="order-no" dir="ltr">{order.orderNo}</bdi>
          </p>
          <p className="text-muted-foreground">{t("success.intro")}</p>
          <section aria-label={t("success.items")}>
            <ul className="divide-y divide-border" data-testid="success-lines">
              {order.items.map((i) => (
                <li key={i.productId} className="flex justify-between gap-3 py-2">
                  <span>
                    {pick(i.titleSnapshot, locale)}{" "}
                    <span className="text-muted-foreground">{t("success.qty", { qty: formatNumber(i.qty, locale) })}</span>
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
              <div className="flex justify-between font-semibold" data-testid="success-total">
                <span>{tc("total")}</span>
                <Price halalas={order.total} locale={locale} />
              </div>
            </div>
          </section>
          <section>
            <h2 className="font-medium">{t("success.deliverTo")}</h2>
            <p>{order.address.fullName} · <PhoneText value={order.address.phone} /></p>
            <p className="text-muted-foreground">
              {[pick(order.address.city, locale) || order.address.cityCode, order.address.area, order.address.street].join(", ")}
            </p>
          </section>
          <section>
            <h2 className="font-medium">{t("success.payment")}</h2>
            <p>{t("cod")}</p>
          </section>
        </div>
      )}
      <Link href="/shop" className="mt-8 inline-block text-sm font-medium text-primary underline">
        {t("continueShopping")}
      </Link>
    </main>
  );
}
