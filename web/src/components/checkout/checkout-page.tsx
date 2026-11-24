"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { PhoneText, Price } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { ApiError, apiErrorMessage, errorMessageKey } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/store";
import { loadCart, useCartStore } from "@/lib/cart/store";
import { createAttemptKeys, listAddresses, placeOrder, type Address } from "@/lib/checkout/api";
import { formatNumber, formatPrice } from "@/lib/format";
import { pick } from "@/lib/pick";

import { AddressForm, type CityOption } from "./address-form";

function pickInitial(list: Address[]): string | null {
  return (list.find((a) => a.isDefault && a.isDeliverable) ?? list.find((a) => a.isDeliverable))?.id ?? null;
}

/** ORD-01 / PROF-02 (W-05). Money, fee, VAT and stock are shown exactly as the API returns them. */
export function CheckoutPage({ cities }: { cities: CityOption[] }) {
  const t = useTranslations("checkout");
  const tc = useTranslations("cart");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const cart = useCartStore((s) => s.cart);
  const cartLoading = useCartStore((s) => s.loading);
  const cartError = useCartStore((s) => s.error);

  const [addresses, setAddresses] = useState<Address[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [placeError, setPlaceError] = useState<unknown>(null);
  const [totalsUpdated, setTotalsUpdated] = useState(false);
  const [itemStock, setItemStock] = useState<Record<string, number>>({});
  const keys = useRef(createAttemptKeys());
  const inFlight = useRef(false);

  const isCustomer = status === "authenticated" && user?.role === "CUSTOMER";

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  const applyAddresses = useCallback((list: Address[]) => {
    setLoadFailed(false);
    setAddresses(list);
    setSelectedId((cur) => (cur && list.some((a) => a.id === cur && a.isDeliverable) ? cur : pickInitial(list)));
    if (list.length === 0) setShowForm(true);
  }, []);
  const loadAddresses = useCallback(async () => {
    try {
      applyAddresses(await listAddresses());
    } catch {
      setLoadFailed(true);
    }
  }, [applyAddresses]);

  useEffect(() => {
    if (!isCustomer) return;
    let live = true;
    listAddresses()
      .then((list) => live && applyAddresses(list))
      .catch(() => live && setLoadFailed(true));
    return () => {
      live = false;
    };
  }, [isCustomer, applyAddresses]);

  // The cart is (re)priced for the selected address: fee, VAT, total and `isDeliverable` come from the API.
  useEffect(() => {
    if (isCustomer && addresses && !placed) void loadCart(selectedId ?? undefined);
  }, [isCustomer, addresses, selectedId, placed]);

  if (status === "unknown" || status === "anonymous") {
    return (
      <Shell>
        <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
      </Shell>
    );
  }
  if (!isCustomer) {
    return (
      <Shell>
        <p role="alert" className="text-sm">{t("adminNotice")}</p>
        <Link href="/" className="mt-3 inline-block text-sm text-primary underline">{t("continueShopping")}</Link>
      </Shell>
    );
  }
  if (loadFailed) {
    return (
      <Shell>
        <p role="alert" className="text-sm text-destructive">{t("loadError")}</p>
        <Button className="mt-3" variant="outline" onClick={() => void loadAddresses()}>{t("retry")}</Button>
      </Shell>
    );
  }
  if (!addresses || placed) {
    return (
      <Shell>
        <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
      </Shell>
    );
  }

  const selected = addresses.find((a) => a.id === selectedId) ?? null;
  const lines = cart?.items ?? [];
  const effective = lines.filter((l) => l.product && l.issue !== "UNAVAILABLE" && l.issue !== "OUT_OF_STOCK");
  const blockedLine = lines.some((l) => l.issue === "UNAVAILABLE" || l.issue === "OUT_OF_STOCK");
  const cartForAddress = !!cart && (selectedId ? cart.address?.id === selectedId : true);
  const notDeliverable = !!selected && cart?.address?.isDeliverable === false;
  const vat = cart?.vat;
  const canPlace =
    !busy &&
    !!selected &&
    selected.isDeliverable &&
    !!cart &&
    cartForAddress &&
    !cartLoading &&
    effective.length > 0 &&
    !blockedLine &&
    !notDeliverable;

  async function onPlace() {
    // Synchronous guard: a double click must not start a second attempt.
    if (inFlight.current || !canPlace || !selected || !cart) return;
    inFlight.current = true;
    setBusy(true);
    setPlaceError(null);
    setTotalsUpdated(false);
    setItemStock({});
    try {
      const key = keys.current.keyFor(selected.id, cart.total);
      const order = await placeOrder({ addressId: selected.id, expectedTotal: cart.total }, key);
      keys.current.reset();
      setPlaced(true);
      useCartStore.setState({ cart: null }); // the server cleared the cart on success
      router.replace(`/checkout/success?id=${encodeURIComponent(order.id)}`);
    } catch (e) {
      setPlaceError(e);
      if (e instanceof ApiError) {
        if (e.code === "PRICE_CHANGED") {
          setTotalsUpdated(true);
          await loadCart(selected.id);
        } else if (e.code === "OUT_OF_STOCK") {
          const items = (e.details as { items?: { productId: string; stock: number }[] } | undefined)?.items;
          setItemStock(Object.fromEntries((items ?? []).map((i) => [i.productId, i.stock])));
          await loadCart(selected.id);
        } else if (e.code === "OUT_OF_DELIVERY_AREA") {
          setSelectedId(null);
          await loadAddresses();
        } else if (e.code === "IDEMPOTENCY_MISMATCH") {
          keys.current.reset();
          await loadCart(selected.id);
        } else if (e.code === "CART_EMPTY") {
          await loadCart(selected.id);
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const errorText = (() => {
    if (!placeError) return null;
    if (placeError instanceof ApiError && placeError.code === "RATE_LIMITED") {
      const w = placeError.retryAfterSeconds;
      const retry =
        w === undefined
          ? ""
          : ` ${w < 60 ? te("retrySeconds", { seconds: Math.max(1, w) }) : te("retryMinutes", { minutes: Math.ceil(w / 60) })}`;
      return `${t("rateLimited")}${retry}`;
    }
    return apiErrorMessage(te as unknown as Parameters<typeof apiErrorMessage>[0], placeError);
  })();

  return (
    <Shell>
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <section aria-labelledby="co-address">
            <h2 id="co-address" className="mb-3 text-xl font-semibold">{t("stepAddress")}</h2>
            {addresses.length === 0 ? <p className="mb-3 text-sm text-muted-foreground">{t("noAddress")}</p> : null}
            <ul role="radiogroup" aria-label={t("addressList")} className="space-y-2" data-testid="address-list">
              {addresses.map((a) => {
                const city = cities.find((c) => c.code === a.cityCode);
                return (
                  <li key={a.id}>
                    <label
                      className={`flex gap-3 rounded-md border p-4 text-sm ${a.isDeliverable ? "cursor-pointer" : "cursor-not-allowed opacity-70"} ${selectedId === a.id ? "border-[1.5px] border-primary" : "border-input"}`}
                    >
                      <input
                        type="radio"
                        name="address"
                        value={a.id}
                        checked={selectedId === a.id}
                        disabled={!a.isDeliverable}
                        onChange={() => {
                          setSelectedId(a.id);
                          setPlaceError(null);
                          setTotalsUpdated(false);
                        }}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{a.label}</span>
                          {a.isDefault ? (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">{t("defaultBadge")}</span>
                          ) : null}
                          {!a.isDeliverable ? (
                            <span
                              className="rounded bg-destructive px-1.5 py-0.5 text-xs text-primary-foreground"
                              data-testid="not-deliverable-badge"
                            >
                              {t("notDeliverableBadge")}
                            </span>
                          ) : null}
                        </span>
                        <span className="block">
                          {a.fullName} · <PhoneText value={a.phone} />
                        </span>
                        <span className="block text-muted-foreground">
                          {[city ? pick(city.name, locale) : a.cityCode, a.area, a.street].join(", ")}
                        </span>
                        {!a.isDeliverable ? (
                          <span className="block text-xs text-destructive">{t("notDeliverableHint")}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {showForm ? (
              <div className="mt-3">
                <AddressForm
                  cities={cities}
                  onCancel={addresses.length > 0 ? () => setShowForm(false) : undefined}
                  onCreated={(a) => {
                    setAddresses((list) => [...(list ?? []), a]);
                    if (a.isDeliverable) setSelectedId(a.id);
                    setShowForm(false);
                  }}
                />
              </div>
            ) : (
              <Button type="button" variant="outline" className="mt-3" onClick={() => setShowForm(true)}>
                {t("addAddress")}
              </Button>
            )}
          </section>

          <section aria-labelledby="co-review">
            <h2 id="co-review" className="mb-3 text-xl font-semibold">{t("stepReview")}</h2>
            {cartError && !cart ? (
              <p role="alert" className="text-sm text-destructive">{te(errorMessageKey(cartError))}</p>
            ) : lines.length === 0 && !cartLoading ? (
              <div data-testid="checkout-empty">
                <p className="text-sm text-muted-foreground">{t("emptyCart")}</p>
                <Link href="/shop" className="mt-2 inline-block text-sm text-primary underline">{t("continueShopping")}</Link>
              </div>
            ) : (
              <ul className="divide-y divide-border" data-testid="checkout-lines">
                {lines.map((l, n) => {
                  const p = l.product;
                  const stockErr = p ? itemStock[p.id] : undefined;
                  const bad = stockErr !== undefined || l.issue === "UNAVAILABLE" || l.issue === "OUT_OF_STOCK";
                  const title = p ? pick(p.title, locale) : tc("issue.UNAVAILABLE");
                  const image = p?.images?.[0];
                  return (
                    <li
                      key={p?.id ?? `gone-${n}`}
                      className={`flex gap-3 py-3 ${bad ? "rounded-md border border-destructive px-2" : ""}`}
                      data-testid="checkout-line"
                      data-invalid={bad ? "true" : undefined}
                    >
                      <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
                        {image ? (
                          <Image src={image.url} alt={pick(image.alt, locale) || title} fill sizes="64px" className="object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5 text-sm">
                        <p className="font-medium">{title}</p>
                        {p ? (
                          <p className="text-muted-foreground">{t("success.qty", { qty: formatNumber(l.qty, locale) })}</p>
                        ) : null}
                        {stockErr !== undefined ? (
                          <p role="alert" className="text-xs text-destructive" data-testid="line-stock-error">
                            {stockErr > 0
                              ? t("lineOnlyLeft", { stock: formatNumber(stockErr, locale) })
                              : t("lineOutOfStock")}
                          </p>
                        ) : l.issue && p ? (
                          <p className="text-xs text-warning-foreground" data-testid="checkout-issue">
                            {l.issue === "PRICE_CHANGED" && l.details
                              ? tc("issue.PRICE_CHANGED", {
                                  oldPrice: formatPrice(l.details.oldPrice, locale),
                                  newPrice: formatPrice(l.details.newPrice, locale),
                                })
                              : tc(`issue.${l.issue}`)}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-sm font-medium">
                        <Price halalas={l.lineTotal} locale={locale} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {blockedLine ? <p role="alert" className="mt-2 text-sm text-destructive">{t("reviewIssue")}</p> : null}
            <Link href="/cart" className="mt-2 inline-block text-sm text-primary underline">{t("backToCart")}</Link>
          </section>

          <section aria-labelledby="co-pay">
            <h2 id="co-pay" className="mb-3 text-xl font-semibold">{t("stepPayment")}</h2>
            <label className="flex gap-3 rounded-md border-[1.5px] border-primary p-4 text-sm">
              <input type="radio" name="payment" checked readOnly className="mt-1" aria-describedby="cod-info" />
              <span>
                <span className="block font-medium">{t("cod")}</span>
                <span id="cod-info" className="block text-muted-foreground">{t("codInfo")}</span>
              </span>
            </label>
          </section>
        </div>

        <aside
          className="h-fit space-y-2 bg-muted p-5 text-sm lg:sticky lg:top-24"
          aria-label={t("title")}
          data-testid="checkout-summary"
        >
          {cart && cartForAddress ? (
            <>
              <Row label={tc("subtotal")} testid="co-subtotal">
                <Price halalas={cart.subtotal} locale={locale} />
              </Row>
              <Row label={tc("delivery")} testid="co-delivery">
                {cart.deliveryFee === 0 ? tc("freeDelivery") : <Price halalas={cart.deliveryFee} locale={locale} />}
              </Row>
              {vat && vat.vatRate > 0 ? (
                <Row
                  label={tc(vat.pricesIncludeVat ? "vatIncluded" : "vatAdded", { rate: formatNumber(vat.vatRate, locale) })}
                  testid="co-vat"
                >
                  <Price halalas={vat.vatAmount} locale={locale} />
                </Row>
              ) : null}
              <Row label={tc("total")} testid="co-total" strong>
                <Price halalas={cart.total} locale={locale} />
              </Row>
            </>
          ) : (
            <p className="text-muted-foreground" role="status">{t("loading")}</p>
          )}
          {notDeliverable ? (
            <p role="alert" className="text-destructive" data-testid="co-not-deliverable">{tc("notDeliverable")}</p>
          ) : null}
          {totalsUpdated ? (
            <p role="status" className="rounded-md border border-warning/50 p-2 text-warning-foreground" data-testid="totals-updated">
              {t("totalsUpdated")}
            </p>
          ) : null}
          {errorText && !totalsUpdated ? (
            <p role="alert" className="rounded-md border border-destructive/40 p-2 text-destructive" data-testid="place-error">
              {errorText}
            </p>
          ) : null}
          <Button type="button" className="w-full" disabled={!canPlace} onClick={() => void onPlace()} data-testid="place-order">
            {busy ? t("placing") : t("placeOrder")}
          </Button>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useTranslations("checkout");
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12" data-testid="checkout-page">
      <h1 className="mb-8 text-3xl font-semibold">{t("title")}</h1>
      {children}
    </main>
  );
}

function Row({ label, children, strong, testid }: { label: string; children: React.ReactNode; strong?: boolean; testid: string }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "font-semibold" : ""}`}>
      <span>{label}</span>
      <span data-testid={testid}>{children}</span>
    </div>
  );
}
