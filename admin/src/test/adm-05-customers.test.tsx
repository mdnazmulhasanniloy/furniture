import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import type { Customer } from "@/lib/customers";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import type { AdminOrder } from "@/lib/orders";
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

const customer = (o: Partial<Customer> = {}): Customer => ({
  id: "c1",
  firstName: "Lina",
  lastName: "Customer",
  email: "lina@example.test",
  role: "CUSTOMER",
  phone: "+966551234567",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
  createdAt: "2026-11-01T09:00:00.000Z",
  orderCount: 3,
  ...o,
});
const order = (id: string, orderNo: string): AdminOrder =>
  ({
    id,
    orderNo,
    items: [],
    subtotal: 100000,
    deliveryFee: 0,
    total: 100000,
    currency: "SAR",
    status: "CONFIRMED",
    paymentStatus: "UNPAID",
    createdAt: "2026-11-20T09:00:00.000Z",
  }) as unknown as AdminOrder;

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let current: Customer = customer();
let failBlock: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  failBlock = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      if (path.startsWith("/admin/customers")) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        if (method === "PATCH") {
          if (failBlock) {
            const f = failBlock;
            failBlock = null;
            return json({ code: f.code, message: "Raw English API text" }, f.status);
          }
          current = { ...current, isBlocked: body!.isBlocked as boolean };
          return json(current);
        }
        if (path.startsWith("/admin/customers?"))
          return json({ items: [current, customer({ id: "c2", firstName: "Omar", isBlocked: true, orderCount: 0 })], meta: { page: 1, limit: 20, total: 2, totalPages: 1 } });
        return json({
          user: current,
          orders: [order("o1", "FX-20261120-0042"), order("o2", "FX-20261120-0043")],
          meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
        });
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
] as const)("ADM-05 · customers (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
    current = customer();
    stubApi();
  });

  it("ADM-05 · lists customers with order count and state, and searches by q", async () => {
    mount("/customers");
    const rows = await screen.findAllByTestId("customer-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("customer-link").getAttribute("href")).toBe("/customers/c1");
    expect(within(rows[0]).getByTestId("customer-state").textContent).toBe(msgs.customers.active);
    expect(within(rows[1]).getByTestId("customer-state").textContent).toBe(msgs.customers.blocked);
    fireEvent.change(screen.getByLabelText(msgs.customers.search), { target: { value: "  lina  " } });
    fireEvent.click(screen.getByRole("button", { name: msgs.customers.searchButton }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("q=lina&") || c.path.endsWith("q=lina"))).toBe(true));
  });

  it("ADM-05 · the detail shows the customer and their orders", async () => {
    mount("/customers/c1");
    expect(await screen.findByTestId("customer-info")).toBeTruthy();
    expect(screen.getByTestId("customer-info").textContent).toContain("lina@example.test");
    const rows = await screen.findAllByTestId("customer-order-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("customer-order-link").getAttribute("href")).toBe("/orders/o1");
  });

  it("ADM-05 · blocking asks for confirmation, then sends isBlocked true", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-block"));
    expect(patches()).toHaveLength(0);
    fireEvent.click(await screen.findByTestId("customer-block-confirm"));
    await waitFor(() => expect(screen.getByTestId("customer-state").textContent).toBe(msgs.customers.blocked));
    expect(patches()[0]).toMatchObject({ path: "/admin/customers/c1/block", body: { isBlocked: true } });
    expect(screen.queryByTestId("customer-block-dialog")).toBeNull();
  });

  it("ADM-05 · unblocking sends isBlocked false and shows only the allowed action", async () => {
    current = customer({ isBlocked: true });
    mount("/customers/c1");
    expect(screen.queryByTestId("customer-block")).toBeNull();
    fireEvent.click(await screen.findByTestId("customer-unblock"));
    await waitFor(() => expect(screen.getByTestId("customer-state").textContent).toBe(msgs.customers.active));
    expect(patches()[0].body).toEqual({ isBlocked: false });
    expect(screen.queryByTestId("customer-unblock")).toBeNull();
  });

  it("ADM-05 · a failed block shows a localized message, never the API text", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-block"));
    failBlock = { status: 404, code: "NOT_FOUND" };
    fireEvent.click(await screen.findByTestId("customer-block-confirm"));
    expect((await screen.findByTestId("customer-block-error")).textContent).toBe(msgs.errors.NOT_FOUND);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-05 · RTL direction and dark mode render the list", async () => {
    document.documentElement.classList.add("dark");
    mount("/customers");
    await screen.findAllByTestId("customer-row");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(msgs.customers.title);
  });
});
