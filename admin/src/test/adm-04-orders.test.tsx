import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { NEXT_STATUSES, type AdminOrder, type OrderStatus } from "@/lib/orders";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

const adminUser = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const order = (o: Partial<AdminOrder> = {}): AdminOrder => ({
  id: "o1",
  orderNo: "FX-20261120-0042",
  user: { id: "c1", firstName: "Lina", lastName: "Customer", email: "lina@example.test" },
  items: [
    {
      productId: "p1",
      titleSnapshot: { en: "Walnut sofa", ar: "أريكة جوز" },
      sku: "SOFA-1",
      imageSnapshot: null,
      unitPrice: 123450,
      qty: 2,
      lineTotal: 246900,
    },
  ],
  address: { fullName: "Lina C", phone: "+966551234567", city: { en: "Riyadh", ar: "الرياض" }, area: "Olaya", street: "Main st 1", notes: null },
  subtotal: 246900,
  deliveryFee: 0,
  vat: { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
  total: 246900,
  currency: "SAR",
  paymentMethod: "COD",
  paymentStatus: "UNPAID",
  status: "PENDING",
  statusHistory: [{ status: "PENDING", at: "2026-11-20T09:00:00.000Z", byUserId: "c1", note: null }],
  customerNote: null,
  adminNote: null,
  createdAt: "2026-11-20T09:00:00.000Z",
  ...o,
});

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let current: AdminOrder = order();
let failStatus: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  failStatus = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      // A6: the invoice takes the seller name from settings.
      if (path === "/admin/settings")
        return json({
          storeName: { en: "Furnixa", ar: "فرنيكسا" }, logo: null, contactEmail: "", contactPhone: "", address: null,
          socials: null, deliveryFee: 2500, freeDeliveryThreshold: null,
          vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
          currency: "SAR", deliveryCities: [], defaultLocale: "ar", seo: null, updatedAt: "2026-11-20T09:00:00.000Z",
        });
      if (path.startsWith("/admin/orders")) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        if (method === "GET" && path.startsWith("/admin/orders?"))
          return json({ items: [current, order({ id: "o2", orderNo: "FX-20261120-0043", status: "DELIVERED" })], meta: { page: 1, limit: 20, total: 2, totalPages: 1 } });
        if (method === "GET") return json(current);
        if (path.endsWith("/status") && failStatus) {
          const f = failStatus;
          failStatus = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        if (path.endsWith("/status")) {
          current = { ...current, status: body!.status as OrderStatus };
          return json(current);
        }
        if (path.endsWith("/note")) {
          current = { ...current, adminNote: body!.adminNote as string | null };
          return json(current);
        }
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(path: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => configureApiClient(null));

const patches = () => calls.filter((c) => c.method === "PATCH");

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-04 · orders (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
    current = order();
    stubApi();
  });

  it("ADM-04 · lists orders, filters by status tab and links to the detail", async () => {
    mount("/orders");
    const rows = await screen.findAllByTestId("order-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("order-link").getAttribute("href")).toBe("/orders/o1");
    fireEvent.click(screen.getByTestId("orders-tab-CONFIRMED"));
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=CONFIRMED"))).toBe(true));
    fireEvent.change(screen.getByLabelText(msgs.orders.search), { target: { value: "FX-2026" } });
    fireEvent.click(screen.getByRole("button", { name: msgs.orders.searchButton }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("q=FX-2026"))).toBe(true));
  });

  it.each(Object.keys(NEXT_STATUSES) as OrderStatus[])(
    "ADM-04 · %s offers only its allowed next statuses",
    async (status) => {
      current = order({ status });
      mount("/orders/o1");
      const box = await screen.findByTestId("order-actions");
      const shown = within(box)
        .queryAllByRole("button")
        .map((b) => b.getAttribute("data-testid"));
      expect(shown).toEqual(NEXT_STATUSES[status].map((s) => `order-action-${s}`));
    },
  );

  it("ADM-04 · a transition sends the status and updates the page", async () => {
    mount("/orders/o1");
    fireEvent.click(await screen.findByTestId("order-action-CONFIRMED"));
    await waitFor(() => expect(screen.getByTestId("order-status").textContent).toBe(msgs.orders.status.CONFIRMED));
    expect(patches()[0]).toMatchObject({ path: "/admin/orders/o1/status", body: { status: "CONFIRMED" } });
    expect(within(screen.getByTestId("order-actions")).queryByTestId("order-action-CONFIRMED")).toBeNull();
  });

  it("ADM-04 · cancelling requires a 3-500 character reason and sends it as the note", async () => {
    mount("/orders/o1");
    fireEvent.click(await screen.findByTestId("order-action-CANCELLED"));
    fireEvent.change(screen.getByLabelText(msgs.orders.cancel.reason), { target: { value: " ab " } });
    fireEvent.click(screen.getByTestId("order-cancel-confirm"));
    expect((await screen.findByTestId("order-cancel-error")).textContent).toBe(msgs.orders.cancel.tooShort);
    expect(patches()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(msgs.orders.cancel.reason), { target: { value: "  Customer unreachable  " } });
    fireEvent.click(screen.getByTestId("order-cancel-confirm"));
    await waitFor(() => expect(screen.getByTestId("order-status").textContent).toBe(msgs.orders.status.CANCELLED));
    expect(patches()[0].body).toEqual({ status: "CANCELLED", note: "Customer unreachable" });
    expect(screen.queryByTestId("order-actions")?.querySelectorAll("button").length).toBe(0);
  });

  it("ADM-04 · 409 INVALID_TRANSITION shows a localized message, never the API text", async () => {
    mount("/orders/o1");
    const btn = await screen.findByTestId("order-action-CONFIRMED");
    failStatus = { status: 409, code: "INVALID_TRANSITION" };
    fireEvent.click(btn);
    expect((await screen.findByTestId("order-transition-error")).textContent).toBe(msgs.orders.invalidTransition);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-04 · the internal note saves trimmed text and clears with null", async () => {
    mount("/orders/o1");
    fireEvent.change(await screen.findByLabelText(msgs.orders.adminNote.title), { target: { value: "  call before 5  " } });
    fireEvent.click(screen.getByTestId("admin-note-save"));
    await waitFor(() => expect(patches()[0].body).toEqual({ adminNote: "call before 5" }));
    fireEvent.change(screen.getByLabelText(msgs.orders.adminNote.title), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("admin-note-save"));
    await waitFor(() => expect(patches()[1].body).toEqual({ adminNote: null }));
  });

  it("ADM-04 · the customer note is rendered as escaped text, never HTML", async () => {
    current = order({ customerNote: "<img src=x onerror=alert(1)><b>hi</b>" });
    mount("/orders/o1");
    const box = await screen.findByTestId("order-customer-note");
    expect(box.querySelector("img, b")).toBeNull();
    expect(box.textContent).toContain("<img src=x onerror=alert(1)><b>hi</b>");
  });

  it("ADM-04 · invoice with VAT 0 shows 'Free delivery' and no VAT line or registration number", async () => {
    // A6: no registration number on the snapshot, so this is a plain invoice with no VAT line and no QR.
    current = order({ deliveryFee: 0, vat: { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null } });
    mount("/orders/o1/invoice");
    const inv = await screen.findByTestId("invoice");
    expect(within(inv).getByTestId("invoice-title").textContent).toBe(msgs.orders.invoice.title);
    expect(within(inv).getByTestId("invoice-delivery-fee").textContent).toBe(msgs.orders.freeDelivery);
    expect(within(inv).queryByTestId("invoice-vat")).toBeNull();
    expect(within(inv).queryByTestId("invoice-vat-reg")).toBeNull();
    expect(inv.getAttribute("lang")).toBe(locale);
    expect(inv.getAttribute("dir")).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it("ADM-04 · invoice with VAT shows the snapshot breakdown, registration number and exact amounts", async () => {
    current = order({
      subtotal: 246900,
      deliveryFee: 2500,
      total: 249400,
      vat: { vatRate: 15, vatAmount: 32530, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: "300000000000003" },
      customerNote: "<b>gift</b>",
    });
    mount("/orders/o1/invoice");
    const inv = await screen.findByTestId("invoice");
    expect(within(inv).getByTestId("invoice-vat").textContent).toContain("325.30");
    expect(within(inv).getByTestId("invoice-vat").textContent).toContain("15");
    expect(within(inv).getByTestId("invoice-vat-reg").textContent).toContain("300000000000003");
    expect(within(inv).getByTestId("invoice-delivery-fee").textContent).toContain("25");
    expect(within(inv).getByTestId("invoice-delivery-fee").textContent).not.toBe(msgs.orders.freeDelivery);
    expect(within(inv).getByTestId("invoice-total").textContent).toContain("2,494");
    expect(within(inv).getByTestId("invoice-vat-note").textContent).toContain(msgs.orders.invoice.pricesIncludeVat);
    expect(within(inv).getByTestId("invoice-customer-note").querySelector("b")).toBeNull();
    expect(within(inv).getByTestId("invoice-items").textContent).toContain(locale === "en" ? "Walnut sofa" : "أريكة جوز");
  });

  it("ADM-04 · the invoice can be printed in the other language", async () => {
    mount("/orders/o1/invoice");
    const inv = await screen.findByTestId("invoice");
    const other = locale === "en" ? "ar" : "en";
    fireEvent.change(screen.getByLabelText(msgs.orders.invoice.language), { target: { value: other } });
    const otherMsgs = other === "en" ? en : ar;
    await waitFor(() => expect(screen.getByTestId("invoice-title").textContent).toBe(otherMsgs.orders.invoice.title));
    expect(inv.getAttribute("dir")).toBe(other === "ar" ? "rtl" : "ltr");
    expect(screen.getByTestId("invoice-delivery-fee").textContent).toBe(otherMsgs.orders.freeDelivery);
  });

  it("ADM-04 · dark mode renders the list with token classes only", async () => {
    document.documentElement.classList.add("dark");
    mount("/orders");
    const table = await screen.findByTestId("orders-table");
    expect(table.parentElement?.className).toContain("bg-card");
  });
});

describe("ADM-04 · locale files", () => {
  it("ADM-04 · en and ar define the same orders keys and INVALID_TRANSITION", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(ar.orders).sort()).toEqual(keys(en.orders).sort());
    expect((en.errors as unknown as Record<string, string>).INVALID_TRANSITION).toBeTruthy();
    expect((ar.errors as unknown as Record<string, string>).INVALID_TRANSITION).toBeTruthy();
  });
});
