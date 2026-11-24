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
let fail: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  fail = null;
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
        if (method !== "GET") {
          if (fail) {
            const f = fail;
            fail = null;
            return json({ code: f.code, message: "Raw English API text" }, f.status);
          }
          if (method === "PATCH" && path.endsWith("/block")) {
            current = body!.isBlocked
              ? { ...current, isBlocked: true, blockedReason: body!.reason as string, blockedAt: "2026-11-24T10:00:00.000Z", blockedById: "u1" }
              : { ...current, isBlocked: false, blockedReason: null, blockedAt: null, blockedById: null };
            return json(current);
          }
          if (method === "PATCH") {
            const { expectedUpdatedAt: _t, ...rest } = body as Record<string, unknown>;
            void _t;
            current = { ...current, ...rest, updatedAt: "2026-11-24T12:00:00.000Z" } as Customer;
            return json(current);
          }
          if (method === "DELETE") {
            current = { ...current, firstName: "Deleted", lastName: "customer", email: "deleted-c1@deleted.invalid", phone: null, isBlocked: true, deletedAt: "2026-11-24T13:00:00.000Z", deletedById: "u1" };
            return json(current);
          }
        }
        if (path.startsWith("/admin/customers?"))
          return json({ items: [current, customer({ id: "c2", firstName: "Omar", isBlocked: true, blockedReason: "Chargebacks", orderCount: 0 })], meta: { page: 1, limit: 20, total: 2, totalPages: 1 } });
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

const writes = () => calls.filter((c) => c.method !== "GET");
const typeInto = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-05 / ADM-17 · customers (%s)", (locale, msgs) => {
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
    expect(within(rows[0]).getByTestId("customer-state").textContent).toBe(msgs.customers.status.active);
    expect(within(rows[1]).getByTestId("customer-state").textContent).toBe(msgs.customers.status.blocked);
    fireEvent.change(screen.getByLabelText(msgs.customers.search), { target: { value: "  lina  " } });
    fireEvent.click(screen.getByRole("button", { name: msgs.customers.searchButton }));
    await waitFor(() => expect(calls.some((c) => c.path.includes("q=lina&") || c.path.endsWith("q=lina"))).toBe(true));
  });

  it("ADM-17 · the status filter asks the API for active, blocked or deleted and toggles off again", async () => {
    mount("/customers");
    await screen.findAllByTestId("customer-row");
    expect(calls.some((c) => c.path.includes("status="))).toBe(false); // default: active and blocked, never deleted
    fireEvent.click(screen.getByTestId("customers-filter-deleted"));
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=deleted"))).toBe(true));
    expect(screen.getByTestId("customers-filter-deleted").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("customers-filter-blocked"));
    await waitFor(() => expect(calls.some((c) => c.path.includes("status=blocked"))).toBe(true));
    expect(screen.getByTestId("customers-filter-deleted").getAttribute("aria-pressed")).toBe("false");
    const before = calls.length;
    fireEvent.click(screen.getByTestId("customers-filter-blocked")); // off: back to the default list
    await waitFor(() => expect(calls.length).toBeGreaterThan(before));
    expect(calls[calls.length - 1]!.path).not.toContain("status=");
    expect(within(screen.getByTestId("customers-status-filter")).getByText(msgs.customers.filter.status)).toBeTruthy();
  });

  it("ADM-05 · the detail shows the customer and their orders", async () => {
    mount("/customers/c1");
    expect(await screen.findByTestId("customer-info")).toBeTruthy();
    expect(screen.getByTestId("customer-info").textContent).toContain("lina@example.test");
    const rows = await screen.findAllByTestId("customer-order-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTestId("customer-order-link").getAttribute("href")).toBe("/orders/o1");
  });

  it("ADM-17 · the admin never sees or sets a password: no password field anywhere on the detail or its dialogs", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-edit"));
    expect(document.querySelector('input[type="password"], [name*="password" i], [id*="password" i]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/passwordHash|\$argon2/i);
  });

  it("ADM-17 · blocking needs a reason: the button stays off until 3 characters, then sends isBlocked true and the trimmed reason", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-block"));
    expect(writes()).toHaveLength(0);
    const confirm = screen.getByTestId("customer-block-confirm") as HTMLButtonElement;
    expect(screen.getByTestId("customer-block-dialog").textContent).toContain(msgs.customers.block.title);
    expect(screen.getByLabelText(msgs.customers.block.reason)).toBeTruthy();
    expect(confirm.disabled).toBe(true);
    typeInto(screen.getByTestId("customer-block-reason"), "  ab  ");
    expect(confirm.disabled).toBe(true);
    typeInto(screen.getByTestId("customer-block-reason"), "  Repeated fake orders  ");
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByTestId("customer-state").textContent).toBe(msgs.customers.status.blocked));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/admin/customers/c1/block", body: { isBlocked: true, reason: "Repeated fake orders" } });
    expect(screen.queryByTestId("customer-block-dialog")).toBeNull();
    expect(screen.getByTestId("customer-blocked-reason").textContent).toContain("Repeated fake orders"); // admin-only view
  });

  it("ADM-17 · the reason box allows at most 300 characters", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-block"));
    expect(screen.getByTestId("customer-block-reason").getAttribute("maxlength")).toBe("300");
  });

  it("ADM-05 · unblocking sends isBlocked false and shows only the allowed actions", async () => {
    current = customer({ isBlocked: true, blockedReason: "Chargebacks", blockedAt: "2026-11-20T10:00:00.000Z" });
    mount("/customers/c1");
    expect(await screen.findByTestId("customer-unblock")).toBeTruthy();
    expect(screen.queryByTestId("customer-block")).toBeNull();
    expect(screen.getByTestId("customer-unblock").textContent).toBe(msgs.customers.unblock.confirm);
    fireEvent.click(await screen.findByTestId("customer-unblock"));
    await waitFor(() => expect(screen.getByTestId("customer-state").textContent).toBe(msgs.customers.status.active));
    expect(writes()[0].body).toEqual({ isBlocked: false });
    expect(screen.queryByTestId("customer-unblock")).toBeNull();
    expect(screen.queryByTestId("customer-blocked-reason")).toBeNull(); // cleared with the block
  });

  it("ADM-05 · a failed block shows a localized message, never the API text", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-block"));
    typeInto(screen.getByTestId("customer-block-reason"), "Because");
    fail = { status: 404, code: "NOT_FOUND" };
    fireEvent.click(screen.getByTestId("customer-block-confirm"));
    expect((await screen.findByTestId("customer-block-error")).textContent).toBe(msgs.errors.NOT_FOUND);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-17 · edit changes name and phone only: the note says so, the email is not a field, and only changed fields are sent with expectedUpdatedAt", async () => {
    current = customer({ updatedAt: "2026-11-20T10:00:00.000Z" });
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-edit"));
    const dlg = screen.getByTestId("customer-edit-dialog");
    expect(dlg.textContent).toContain(msgs.customers.edit.note);
    expect(within(dlg).queryByLabelText(msgs.customers.col.email)).toBeNull();
    typeInto(within(dlg).getByLabelText(msgs.customers.firstName), "Noura");
    typeInto(within(dlg).getByLabelText(msgs.customers.phone), "0555123456");
    fireEvent.click(screen.getByTestId("customer-edit-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "PATCH", path: "/admin/customers/c1", body: { expectedUpdatedAt: "2026-11-20T10:00:00.000Z", firstName: "Noura", phone: "0555123456" } });
    await waitFor(() => expect(screen.queryByTestId("customer-edit-dialog")).toBeNull());
    expect(await screen.findByRole("heading", { level: 1, name: "Noura Customer" })).toBeTruthy();
  });

  it("ADM-17 · a phone that is not a Saudi mobile, or an empty name, is refused before any request; an empty phone clears it (null)", async () => {
    current = customer({ updatedAt: "2026-11-20T10:00:00.000Z" });
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-edit"));
    const dlg = screen.getByTestId("customer-edit-dialog");
    typeInto(within(dlg).getByLabelText(msgs.customers.phone), "+971501234567");
    fireEvent.click(screen.getByTestId("customer-edit-save"));
    expect((await screen.findByTestId("customer-edit-error")).textContent).toBe(msgs.errors.VALIDATION_ERROR);
    typeInto(within(dlg).getByLabelText(msgs.customers.phone), "+966551234567");
    typeInto(within(dlg).getByLabelText(msgs.customers.lastName), "   ");
    fireEvent.click(screen.getByTestId("customer-edit-save"));
    await waitFor(() => expect(screen.getByTestId("customer-edit-error")).toBeTruthy());
    expect(writes()).toHaveLength(0);
    typeInto(within(dlg).getByLabelText(msgs.customers.lastName), "Customer");
    typeInto(within(dlg).getByLabelText(msgs.customers.phone), "");
    fireEvent.click(screen.getByTestId("customer-edit-save"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ expectedUpdatedAt: "2026-11-20T10:00:00.000Z", phone: null });
  });

  it("ADM-17 · a stale edit is reported by code in the admin's language", async () => {
    current = customer({ updatedAt: "2026-11-20T10:00:00.000Z" });
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-edit"));
    typeInto(within(screen.getByTestId("customer-edit-dialog")).getByLabelText(msgs.customers.firstName), "Changed");
    fail = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(screen.getByTestId("customer-edit-save"));
    expect((await screen.findByTestId("customer-edit-error")).textContent).toBe(msgs.errors.STALE_UPDATE);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-17 · delete: the admin types the customer's email, the button stays off until it matches, then the soft delete is sent with confirmEmail", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-delete"));
    const dlg = screen.getByTestId("customer-delete-dialog");
    expect(dlg.textContent).toContain(msgs.customers.delete.title);
    expect(dlg.textContent).toContain(msgs.customers.delete.body);
    expect(within(dlg).getByLabelText(msgs.customers.delete.typeEmail.replace("{email}", "lina@example.test"))).toBeTruthy();
    const confirm = screen.getByTestId("customer-delete-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    typeInto(screen.getByTestId("customer-delete-email"), "lina@example");
    expect(confirm.disabled).toBe(true);
    typeInto(screen.getByTestId("customer-delete-email"), " LINA@example.test ");
    expect(confirm.disabled).toBe(false);
    expect(writes()).toHaveLength(0);
    fireEvent.click(confirm);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual({ method: "DELETE", path: "/admin/customers/c1", body: { confirmEmail: "LINA@example.test" } });
    // the page now shows the anonymised, read-only customer
    await waitFor(() => expect(screen.getByTestId("customer-state").textContent).toBe(msgs.customers.status.deleted));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(msgs.customers.deletedName);
    expect(screen.queryByTestId("customer-actions")).toBeNull();
  });

  it("ADM-17 · delete errors are shown in the admin's language: open orders, deleted, mismatch", async () => {
    mount("/customers/c1");
    fireEvent.click(await screen.findByTestId("customer-delete"));
    typeInto(screen.getByTestId("customer-delete-email"), "lina@example.test");
    for (const code of ["CUSTOMER_HAS_OPEN_ORDERS", "CUSTOMER_DELETED", "CONFIRM_EMAIL_MISMATCH", "FORBIDDEN_TARGET"] as const) {
      fail = { status: code === "FORBIDDEN_TARGET" ? 403 : code === "CONFIRM_EMAIL_MISMATCH" ? 422 : 409, code };
      fireEvent.click(screen.getByTestId("customer-delete-confirm"));
      await waitFor(() => expect(screen.getByTestId("customer-delete-error").textContent).toBe(msgs.errors[code]));
    }
    expect(msgs.errors.CUSTOMER_HAS_OPEN_ORDERS).toBe(locale === "en" ? "This customer has pending or confirmed orders. Finish or cancel them first." : "لدى هذا العميل طلبات قيد الانتظار أو مؤكدة. أنهِها أو ألغِها أولًا.");
    expect(msgs.errors.FORBIDDEN_TARGET).toBe(locale === "en" ? "Admins cannot be changed here." : "لا يمكن تعديل المشرفين من هنا.");
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect(screen.getByTestId("customer-delete-dialog")).toBeTruthy(); // still open after a refusal
  });

  it("ADM-17 · a deleted customer in the list keeps the Deleted chip and its page has no actions", async () => {
    current = customer({ firstName: "Deleted", lastName: "customer", isBlocked: true, deletedAt: "2026-11-24T13:00:00.000Z" });
    mount("/customers");
    const rows = await screen.findAllByTestId("customer-row");
    expect(within(rows[0]).getByTestId("customer-state").getAttribute("data-state")).toBe("deleted");
    expect(within(rows[0]).getByTestId("customer-state").textContent).toBe(msgs.customers.status.deleted);
  });

  it("ADM-05 · RTL direction and dark mode render the list", async () => {
    document.documentElement.classList.add("dark");
    mount("/customers");
    await screen.findAllByTestId("customer-row");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(msgs.customers.title);
  });
});

describe("ADM-17 · customers locale files", () => {
  it("ADM-17 · en and ar define the same customers keys and the approved wording", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(ar.customers).sort()).toEqual(keys(en.customers).sort());
    expect(en.customers.delete.typeEmail).toBe("Type {email} to confirm");
    expect(ar.customers.delete.typeEmail).toBe("اكتب {email} للتأكيد");
    expect(ar.customers.block.reason).toBe("السبب (مطلوب، يراه المشرفون فقط)");
  });
});
