// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import { CheckoutPage } from "@/components/checkout/checkout-page";
import { SuccessPage } from "@/components/checkout/success-page";
import { configureApiClient } from "@/lib/api/client";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import { resetCartStore } from "@/lib/cart/store";
import { createAttemptKeys } from "@/lib/checkout/api";

type L = "en" | "ar";
const messages = { en, ar } as const;
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

const A1 = "a".repeat(24);
const A2 = "b".repeat(24);
const P1 = "c".repeat(24);
const ORDER_ID = "d".repeat(24);
const sofa: HomeProduct = {
  id: P1, slug: "sofa", title: { en: "Oak sofa", ar: "أريكة بلوط" },
  type: "NEW", condition: "NEW", price: 100000, stock: 3, images: [],
};
const cities = [
  { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" } },
  { code: "jeddah", name: { en: "Jeddah", ar: "جدة" } },
];
const addr = (id: string, over: Record<string, unknown> = {}) => ({
  id, label: id === A1 ? "Home" : "Work", fullName: "Sara Ali", phone: "+966551234567",
  cityCode: "riyadh", area: "Olaya", street: "King Fahd Rd", notes: null, isDefault: id === A1, isDeliverable: true, ...over,
});
const vat0 = { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true };
const cartFor = (addressId: string | undefined, over: Record<string, unknown> = {}) => ({
  items: [{ product: sofa, qty: 2, lineTotal: 200000, issue: null }],
  subtotal: 200000, deliveryFee: 5000, vat: vat0, total: 205000,
  address: addressId ? { id: addressId, cityCode: "riyadh", isDeliverable: true } : null, ...over,
});
const orderBody = {
  id: ORDER_ID, orderNo: "FX-20261124-0042", status: "PENDING", paymentMethod: "COD",
  items: [{ productId: P1, titleSnapshot: sofa.title, unitPrice: 100000, qty: 2, lineTotal: 200000 }],
  address: { fullName: "Sara Ali", phone: "+966551234567", cityCode: "riyadh", city: { en: "Riyadh", ar: "الرياض" }, area: "Olaya", street: "King Fahd Rd" },
  subtotal: 200000, deliveryFee: 5000, vat: vat0, total: 205000,
};

type Call = { path: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
type Res = { status?: number; body: unknown; headers?: Record<string, string> };
function mockApi(handler: (c: Call) => Res | "network") {
  calls = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init: RequestInit) => {
      const c: Call = {
        path: String(url).replace(/^.*\/api\/v1/, ""),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(c);
      const r = handler(c);
      if (r === "network") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "Content-Type": "application/json", ...r.headers },
      });
    }) as typeof fetch,
  });
}
const login = (role = "CUSTOMER") =>
  useAuthStore.setState({
    status: "authenticated", accessToken: "t",
    user: { id: "u", firstName: "A", lastName: "B", email: "a@b.c", role, isVerified: true, isBlocked: false, preferredLocale: "en" },
  });

/** Default API: two deliverable addresses; the cart follows the addressId query. */
function baseHandler(overrides: (c: Call) => Res | "network" | null = () => null) {
  return (c: Call): Res | "network" => {
    const o = overrides(c);
    if (o) return o;
    if (c.path === "/me/addresses" && c.method === "GET") return { body: [addr(A1), addr(A2)] };
    if (c.path.startsWith("/cart")) {
      const id = new URL(`http://x${c.path}`).searchParams.get("addressId") ?? undefined;
      return { body: cartFor(id) };
    }
    return { status: 404, body: { code: "NOT_FOUND" } };
  };
}
const placeCalls = () => calls.filter((c) => c.path === "/orders" && c.method === "POST");

beforeEach(() => {
  replace.mockClear();
  resetCartStore();
  useAuthStore.getState().clear();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

async function ready(locale: L) {
  wrap(locale, <CheckoutPage cities={cities} />);
  await waitFor(() => expect((screen.getByTestId("place-order") as HTMLButtonElement).disabled).toBe(false));
}

for (const locale of ["en", "ar"] as const) {
  const m = messages[locale];
  describe(`ORD-01 · checkout (${locale})`, () => {
    it(`ORD-01 · places a COD order with expectedTotal and an Idempotency-Key, then goes to success (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) => (c.path === "/orders" ? { status: 201, body: orderBody } : null)));
      await ready(locale);
      // Totals come from the cart API for the default address: fee + total as returned.
      expect(screen.getByTestId("co-total").textContent).toContain("2,050");
      expect(screen.getByText(m.checkout.cod)).toBeTruthy();
      fireEvent.click(screen.getByTestId("place-order"));
      fireEvent.click(screen.getByTestId("place-order")); // double click: one request
      await waitFor(() => expect(replace).toHaveBeenCalledWith(`/checkout/success?id=${ORDER_ID}`));
      const posts = placeCalls();
      expect(posts).toHaveLength(1);
      expect(posts[0].body).toEqual({ addressId: A1, expectedTotal: 205000 });
      expect(posts[0].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(calls.some((c) => c.path === `/cart?addressId=${A1}`)).toBe(true);
    });

    it(`ORD-01 · reuses the Idempotency-Key on a network retry and uses a fresh one when the request changes (${locale})`, async () => {
      login();
      let fail = true;
      mockApi(baseHandler((c) => (c.path === "/orders" ? (fail ? "network" : { status: 200, body: orderBody }) : null)));
      await ready(locale);
      fireEvent.click(screen.getByTestId("place-order"));
      await waitFor(() => expect(screen.getByTestId("place-error").textContent).toBe(m.errors.NETWORK_ERROR));
      fail = false;
      fireEvent.click(screen.getByTestId("place-order"));
      await waitFor(() => expect(replace).toHaveBeenCalled());
      const [a, b] = placeCalls();
      expect(a.headers["Idempotency-Key"]).toBe(b.headers["Idempotency-Key"]);

      // Unit: a changed address or total gets a fresh key.
      const keys = createAttemptKeys();
      const k1 = keys.keyFor(A1, 100);
      expect(keys.keyFor(A1, 100)).toBe(k1);
      expect(keys.keyFor(A1, 200)).not.toBe(k1);
      expect(keys.keyFor(A2, 200)).not.toBe(k1);
    });

    it(`ORD-01 · OUT_OF_STOCK highlights the failing line with the live stock (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path === "/orders"
          ? { status: 409, body: { code: "OUT_OF_STOCK", details: { items: [{ productId: P1, stock: 1 }] } } }
          : null));
      await ready(locale);
      fireEvent.click(screen.getByTestId("place-order"));
      const err = await screen.findByTestId("line-stock-error");
      expect(err.textContent).toBe(m.checkout.lineOnlyLeft.replace("{stock}", "1"));
      expect(screen.getByTestId("checkout-line").getAttribute("data-invalid")).toBe("true");
      expect(replace).not.toHaveBeenCalled();
    });

    it(`ORD-01 · PRICE_CHANGED refreshes the totals and shows the updated notice (${locale})`, async () => {
      login();
      let priced = false;
      mockApi(baseHandler((c) => {
        if (c.path === "/orders") {
          priced = true;
          return { status: 409, body: { code: "PRICE_CHANGED", details: { expectedTotal: 205000, total: 215000, items: [] } } };
        }
        if (c.path.startsWith("/cart") && priced) return { body: cartFor(A1, { total: 215000, deliveryFee: 15000 }) };
        return null;
      }));
      await ready(locale);
      fireEvent.click(screen.getByTestId("place-order"));
      expect((await screen.findByTestId("totals-updated")).textContent).toBe(m.checkout.totalsUpdated);
      await waitFor(() => expect(screen.getByTestId("co-total").textContent).toContain("2,150"));
      // Next attempt sends the refreshed total with a new key.
      mockApi(baseHandler((c) => (c.path === "/orders" ? { status: 201, body: orderBody } : c.path.startsWith("/cart") ? { body: cartFor(A1, { total: 215000 }) } : null)));
      fireEvent.click(screen.getByTestId("place-order"));
      await waitFor(() => expect(replace).toHaveBeenCalled());
      expect(placeCalls()[0].body).toEqual({ addressId: A1, expectedTotal: 215000 });
    });

    it(`ORD-01 · a not deliverable cart address shows the message and disables place order (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path.startsWith("/cart") ? { body: cartFor(A1, { address: { id: A1, cityCode: "riyadh", isDeliverable: false } }) } : null));
      wrap(locale, <CheckoutPage cities={cities} />);
      expect((await screen.findByTestId("co-not-deliverable")).textContent).toBe(m.cart.notDeliverable);
      expect((screen.getByTestId("place-order") as HTMLButtonElement).disabled).toBe(true);
    });

    it(`ORD-01 · OUT_OF_DELIVERY_AREA and the order limits show localized messages (${locale})`, async () => {
      login();
      for (const [status, code, expected, headers] of [
        [409, "TOO_MANY_PENDING_ORDERS", m.errors.TOO_MANY_PENDING_ORDERS, undefined],
        [429, "RATE_LIMITED", m.checkout.rateLimited, { "Retry-After": "30" }],
      ] as const) {
        cleanup();
        mockApi(baseHandler((c) => (c.path === "/orders" ? { status, body: { code, message: "English only" }, headers: headers as Record<string, string> | undefined } : null)));
        await ready(locale);
        fireEvent.click(screen.getByTestId("place-order"));
        const el = await screen.findByTestId("place-error");
        expect(el.textContent).toContain(expected);
        expect(el.textContent).not.toContain("English only");
      }
      cleanup();
      mockApi(baseHandler((c) => (c.path === "/orders" ? { status: 422, body: { code: "OUT_OF_DELIVERY_AREA" } } : null)));
      await ready(locale);
      fireEvent.click(screen.getByTestId("place-order"));
      expect((await screen.findByTestId("place-error")).textContent).toBe(m.errors.OUT_OF_DELIVERY_AREA);
    });

    it(`ORD-01 · fee line shows Free delivery at 0 and the VAT line only when vatRate > 0 (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path.startsWith("/cart")
          ? { body: cartFor(A1, { deliveryFee: 0, vat: { vatRate: 15, vatAmount: 30000, applyToDelivery: true, pricesIncludeVat: false }, total: 230000 }) }
          : null));
      await ready(locale);
      expect(screen.getByTestId("co-delivery").textContent).toBe(m.cart.freeDelivery);
      expect(screen.getByTestId("co-vat")).toBeTruthy();
      expect(screen.getByTestId("co-total").textContent).toContain("2,300");
    });

    it(`ORD-01 · all-zero defaults: Free delivery, no VAT line, total equals subtotal (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path.startsWith("/cart") ? { body: cartFor(A1, { deliveryFee: 0, total: 200000 }) } : null));
      await ready(locale);
      expect(screen.getByTestId("co-delivery").textContent).toBe(m.cart.freeDelivery);
      expect(screen.queryByTestId("co-vat")).toBeNull();
      expect(screen.getByTestId("co-total").textContent).toContain("2,000");
    });

    it(`UI-01 · checkout v2: flat sand summary, outlined address and payment options, no card around the form (${locale})`, async () => {
      login();
      mockApi(baseHandler());
      await ready(locale);
      const summary = screen.getByTestId("checkout-summary");
      expect(summary.className).toContain("bg-muted");
      expect(summary.className).not.toMatch(/shadow|rounded|border/);
      const options = within(screen.getByTestId("address-list")).getAllByRole("radio").map((r) => r.closest("label")!);
      expect(options[0].className).toContain("border-primary"); // the selected address
      expect(options[1].className).toContain("border-input"); // fields and options sit on paper with the input border
      expect(options[0].className).not.toMatch(/bg-card|bg-muted/);
      const cod = screen.getByRole("radio", { name: new RegExp(m.checkout.cod) }).closest("label")!;
      expect(cod.className).toContain("border-primary");
      expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-3xl");
    });

    it(`ORD-01 · VAT label follows pricesIncludeVat and the total is the API's (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path.startsWith("/cart")
          ? { body: cartFor(A1, { vat: { vatRate: 15, vatAmount: 30000, applyToDelivery: true, pricesIncludeVat: true } }) }
          : null));
      await ready(locale);
      expect(screen.getByTestId("co-vat").parentElement?.textContent).toContain(m.cart.vatIncluded.replace("{rate}", "15"));
      await waitFor(() => expect(screen.getByTestId("co-total").textContent).toContain("2,050"));
      cleanup();
      mockApi(baseHandler((c) =>
        c.path.startsWith("/cart")
          ? { body: cartFor(A1, { vat: { vatRate: 15, vatAmount: 30000, applyToDelivery: true, pricesIncludeVat: false }, total: 235000 }) }
          : null));
      await ready(locale);
      expect(screen.getByTestId("co-vat").parentElement?.textContent).toContain(m.cart.vatAdded.replace("{rate}", "15"));
      await waitFor(() => expect(screen.getByTestId("co-total").textContent).toContain("2,350"));
    });

    it(`ORD-01 · the fee is re-fetched and shown when another address (city) is selected (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) => {
        if (c.path === "/me/addresses") return { body: [addr(A1), addr(A2, { cityCode: "jeddah" })] };
        if (c.path === `/cart?addressId=${A2}`) {
          return { body: cartFor(A2, { deliveryFee: 0, total: 200000, address: { id: A2, cityCode: "jeddah", isDeliverable: true } }) };
        }
        return null;
      }));
      await ready(locale);
      expect(screen.getByTestId("co-delivery").textContent).toContain("50");
      const radios = screen.getAllByRole("radio").filter((r) => (r as HTMLInputElement).name === "address") as HTMLInputElement[];
      fireEvent.click(radios[1]);
      await waitFor(() => expect(screen.getByTestId("co-delivery").textContent).toBe(m.cart.freeDelivery));
      expect(calls.some((c) => c.path === `/cart?addressId=${A2}`)).toBe(true);
      expect(screen.getByTestId("co-total").textContent).toContain("2,000");
    });

    it(`ORD-01 · success page shows the order number and totals from the API (${locale})`, async () => {
      login();
      mockApi(() => ({ body: orderBody }));
      wrap(locale, <SuccessPage orderId={ORDER_ID} />);
      expect((await screen.findByTestId("order-no")).textContent).toBe("FX-20261124-0042");
      expect(screen.getByTestId("success-total").textContent).toContain("2,050");
      expect(screen.getByText(m.checkout.cod)).toBeTruthy();
      expect(calls[0].path).toBe(`/orders/${ORDER_ID}`);
    });
  });

  describe(`PROF-02 · checkout addresses (${locale})`, () => {
    it(`PROF-02 · an address with isDeliverable false is badged and cannot be chosen (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) =>
        c.path === "/me/addresses" ? { body: [addr(A1, { isDeliverable: false }), addr(A2)] } : null));
      await ready(locale);
      expect(screen.getByTestId("not-deliverable-badge").textContent).toBe(m.checkout.notDeliverableBadge);
      const radios = screen.getAllByRole("radio", { name: /./ }).filter((r) => (r as HTMLInputElement).name === "address") as HTMLInputElement[];
      expect(radios[0].disabled).toBe(true);
      expect(radios[1].checked).toBe(true); // first deliverable is pre-selected
      expect(calls.some((c) => c.path === `/cart?addressId=${A2}`)).toBe(true);
    });

    it(`PROF-02 · with no address the inline form is shown and a saved address becomes selected (${locale})`, async () => {
      login();
      let saved = false;
      mockApi(baseHandler((c) => {
        if (c.path === "/me/addresses" && c.method === "GET") return { body: [] };
        if (c.path === "/me/addresses" && c.method === "POST") {
          saved = true;
          return { status: 201, body: addr(A1) };
        }
        if (c.path.startsWith("/cart") && !saved) return { body: cartFor(undefined) };
        return null;
      }));
      wrap(locale, <CheckoutPage cities={cities} />);
      const form = await screen.findByTestId("address-form");
      expect(screen.getByText(m.checkout.noAddress)).toBeTruthy();
      expect((screen.getByTestId("place-order") as HTMLButtonElement).disabled).toBe(true);

      // Validation: empty submit and a bad phone make no request.
      fireEvent.submit(form);
      expect(form.querySelectorAll(".text-destructive").length).toBeGreaterThan(0);
      expect(calls.some((c) => c.method === "POST")).toBe(false);

      const type = (label: string, value: string) =>
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      type(m.checkout.form.label, "Home");
      type(m.checkout.form.fullName, "Sara Ali");
      type(m.checkout.form.phone, "٠٥٥١٢٣٤٥٦٧"); // Arabic-Indic digits, normalised like the backend
      type(m.checkout.form.city, "riyadh");
      type(m.checkout.form.area, "Olaya");
      type(m.checkout.form.street, "King Fahd Rd");
      fireEvent.submit(form);
      await waitFor(() => expect(calls.some((c) => c.path === "/me/addresses" && c.method === "POST")).toBe(true));
      const post = calls.find((c) => c.path === "/me/addresses" && c.method === "POST");
      expect(post?.body).toEqual({
        label: "Home", fullName: "Sara Ali", phone: "+966551234567", cityCode: "riyadh", area: "Olaya", street: "King Fahd Rd",
      });
      await waitFor(() => expect((screen.getByTestId("place-order") as HTMLButtonElement).disabled).toBe(false));
      expect(screen.getByText(locale === "en" ? "Riyadh, Olaya, King Fahd Rd" : "الرياض, Olaya, King Fahd Rd", { exact: false })).toBeTruthy();
    });

    it(`PROF-02 · the city is a select of the active cities with a fixed +966 prefix (${locale})`, async () => {
      login();
      mockApi(baseHandler((c) => (c.path === "/me/addresses" && c.method === "GET" ? { body: [] } : null)));
      wrap(locale, <CheckoutPage cities={cities} />);
      await screen.findByTestId("address-form");
      const select = screen.getByLabelText(m.checkout.form.city) as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.value)).toEqual(["", "riyadh", "jeddah"]);
      expect(screen.getByText("+966")).toBeTruthy();
    });

    it(`PROF-02 · a guest is sent to login (${locale})`, async () => {
      useAuthStore.setState({ status: "anonymous", accessToken: null, user: null });
      mockApi(baseHandler());
      wrap(locale, <CheckoutPage cities={cities} />);
      await act(async () => {});
      expect(replace).toHaveBeenCalledWith("/login");
      expect(calls).toHaveLength(0);
    });
  });
}
