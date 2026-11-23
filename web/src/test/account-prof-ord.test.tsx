// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readFileSync } from "node:fs";
import path from "node:path";
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

import { AccountShell } from "@/components/account/account-shell";
import { AddressesPanel } from "@/components/account/addresses-panel";
import { OrderDetail } from "@/components/account/order-detail";
import { OrdersList } from "@/components/account/orders-list";
import { ProfileForm } from "@/components/account/profile-form";
import { configureApiClient } from "@/lib/api/client";
import { useAuthStore } from "@/lib/auth/store";

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
const O1 = "d".repeat(24);
const cities = [
  { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" } },
  { code: "jeddah", name: { en: "Jeddah", ar: "جدة" } },
];
const addr = (id: string, over: Record<string, unknown> = {}) => ({
  id, label: id === A1 ? "Home" : "Work", fullName: "Sara Ali", phone: "+966551234567",
  cityCode: "riyadh", area: "Olaya", street: "King Fahd Rd", notes: null, isDefault: id === A1, isDeliverable: true, ...over,
});
const vat0 = { vatRate: 0, vatAmount: 0, applyToDelivery: true, pricesIncludeVat: true };
const order = (over: Record<string, unknown> = {}) => ({
  id: O1, orderNo: "FX-20261124-0042", status: "PENDING", paymentMethod: "COD", paymentStatus: "UNPAID",
  items: [{ productId: "c".repeat(24), titleSnapshot: { en: "Oak sofa", ar: "أريكة بلوط" }, unitPrice: 100000, qty: 2, lineTotal: 200000 }],
  address: { fullName: "Sara Ali", phone: "+966551234567", cityCode: "riyadh", city: { en: "Riyadh", ar: "الرياض" }, area: "Olaya", street: "King Fahd Rd" },
  subtotal: 200000, deliveryFee: 5000, vat: vat0, total: 205000, createdAt: "2026-11-24T08:00:00.000Z",
  statusHistory: [{ status: "PENDING", at: "2026-11-24T08:00:00.000Z" }], ...over,
});

type Call = { path: string; method: string; body: unknown };
let calls: Call[] = [];
type Res = { status?: number; body?: unknown };
function mockApi(handler: (c: Call) => Res) {
  calls = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init: RequestInit) => {
      const c: Call = {
        path: String(url).replace(/^.*\/api\/v1/, ""),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(c);
      const r = handler(c);
      if (r.status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
}
const user = (over: Record<string, unknown> = {}) => ({
  id: "u", firstName: "Sara", lastName: "Ali", email: "sara@x.sa", role: "CUSTOMER", phone: "+966551234567",
  isVerified: true, isBlocked: false, preferredLocale: "ar" as const, ...over,
});
const login = (over: Record<string, unknown> = {}) =>
  useAuthStore.setState({ status: "authenticated", accessToken: "t", user: user(over) as never });

beforeEach(() => {
  replace.mockClear();
  useAuthStore.getState().clear();
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
});

const typeIn = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

for (const locale of ["en", "ar"] as const) {
  const m = messages[locale];

  describe(`PROF-01 · profile (${locale})`, () => {
    it(`PROF-01 · saves only the changed fields with a normalised phone and updates the session user (${locale})`, async () => {
      login();
      mockApi((c) => (c.path === "/me" ? { body: user({ firstName: "Noor", phone: "+966501112233" }) } : { status: 404 }));
      wrap(locale, <ProfileForm />);
      typeIn(screen.getByLabelText(m.account.profile.firstName), "Noor");
      typeIn(screen.getByLabelText(m.account.profile.phone), "٠٥٠ ١١١ ٢٢٣٣");
      fireEvent.click(screen.getByRole("button", { name: m.account.profile.save }));
      await waitFor(() => expect(screen.getByTestId("profile-saved")).toBeTruthy());
      expect(calls).toHaveLength(1);
      expect(calls[0].method).toBe("PATCH");
      expect(calls[0].body).toEqual({ firstName: "Noor", phone: "+966501112233" });
      expect(useAuthStore.getState().user?.firstName).toBe("Noor");
      expect(document.body.textContent).not.toContain("avatar");
    });

    it(`PROF-01 · an invalid phone shows the localized error and sends nothing (${locale})`, () => {
      login();
      mockApi(() => ({ status: 500 }));
      wrap(locale, <ProfileForm />);
      typeIn(screen.getByLabelText(m.account.profile.phone), "0212345678");
      fireEvent.click(screen.getByRole("button", { name: m.account.profile.save }));
      expect(screen.getByText(m.checkout.validation.phone)).toBeTruthy();
      expect(calls).toHaveLength(0);
    });

    it(`PROF-01 · an API VALIDATION_ERROR is shown by code, never the API message (${locale})`, async () => {
      login();
      mockApi(() => ({ status: 422, body: { code: "VALIDATION_ERROR", message: "phone: invalid secret detail" } }));
      wrap(locale, <ProfileForm />);
      typeIn(screen.getByLabelText(m.account.profile.lastName), "Hassan");
      fireEvent.click(screen.getByRole("button", { name: m.account.profile.save }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(m.errors.VALIDATION_ERROR);
    });

    it(`NFR-06 · the profile phone field accepts and rejects per the x-canonical-pattern read from api-spec.yaml (${locale})`, async () => {
      const spec = readFileSync(
        path.resolve(import.meta.dirname, "../../../project-docs/04-architecture/api-spec.yaml"),
        "utf8",
      );
      const pattern = new RegExp(spec.match(/x-canonical-pattern: '([^']+)'/)![1]);
      login({ phone: null });
      mockApi(() => ({ body: user() }));
      wrap(locale, <ProfileForm />);
      const phone = screen.getByLabelText(m.account.profile.phone);
      const save = screen.getByRole("button", { name: m.account.profile.save });
      for (const [raw, canonical] of [["0551234567", "0551234567"], ["+966-55-123-4567", "+966551234567"], ["5 5123 4567", "551234567"]] as const) {
        expect(pattern.test(canonical)).toBe(true);
        typeIn(phone, raw);
        fireEvent.click(save);
        await waitFor(() => expect(screen.queryByText(m.checkout.validation.phone)).toBeNull());
      }
      for (const bad of ["0112345678", "05512345", "abc"]) {
        expect(pattern.test(bad)).toBe(false);
        typeIn(phone, bad);
        fireEvent.click(save);
        expect(screen.getByText(m.checkout.validation.phone)).toBeTruthy();
      }
    });
  });

  describe(`PROF-02 · addresses (${locale})`, () => {
    it(`PROF-02 · lists addresses, flags Not deliverable from isDeliverable and edits with an active city (${locale})`, async () => {
      login();
      let list = [addr(A1), addr(A2, { cityCode: "tabuk", isDeliverable: false })];
      mockApi((c) => {
        if (c.path === "/me/addresses" && c.method === "GET") return { body: list };
        if (c.path === `/me/addresses/${A2}` && c.method === "PATCH") {
          list = [addr(A1), addr(A2, { cityCode: "jeddah", isDeliverable: true })];
          return { body: list[1] };
        }
        return { status: 404 };
      });
      wrap(locale, <AddressesPanel cities={cities} />);
      await screen.findAllByTestId("address-item");
      expect(screen.getAllByTestId("not-deliverable")).toHaveLength(1);
      fireEvent.click(screen.getAllByRole("button", { name: m.account.addresses.edit })[1]);
      const city = screen.getByLabelText(m.checkout.form.city) as HTMLSelectElement;
      expect(city.value).toBe(""); // the deactivated city is not preselected
      fireEvent.click(screen.getByRole("button", { name: m.checkout.form.save }));
      expect(screen.getByText(m.checkout.validation.required)).toBeTruthy();
      typeIn(city, "jeddah");
      fireEvent.click(screen.getByRole("button", { name: m.checkout.form.save }));
      await waitFor(() => expect(screen.queryByTestId("not-deliverable")).toBeNull());
      const patch = calls.find((c) => c.method === "PATCH")!;
      expect((patch.body as { cityCode: string }).cityCode).toBe("jeddah");
    });

    it(`PROF-02 · adds an address as default, makes another default and deletes after confirmation (${locale})`, async () => {
      login();
      mockApi((c) => {
        if (c.path === "/me/addresses" && c.method === "GET") return { body: [addr(A1), addr(A2)] };
        if (c.path === "/me/addresses" && c.method === "POST") return { status: 201, body: addr("e".repeat(24)) };
        if (c.method === "PATCH") return { body: addr(A2, { isDefault: true }) };
        if (c.method === "DELETE") return { status: 204 };
        return { status: 404 };
      });
      wrap(locale, <AddressesPanel cities={cities} />);
      await screen.findAllByTestId("address-item");

      fireEvent.click(screen.getByTestId("add-address"));
      typeIn(screen.getByLabelText(m.checkout.form.label), "Office");
      typeIn(screen.getByLabelText(m.checkout.form.fullName), "Sara Ali");
      typeIn(screen.getByLabelText(m.checkout.form.phone), "0551234567");
      typeIn(screen.getByLabelText(m.checkout.form.city), "riyadh");
      typeIn(screen.getByLabelText(m.checkout.form.area), "Olaya");
      typeIn(screen.getByLabelText(m.checkout.form.street), "King Fahd Rd");
      fireEvent.click(screen.getByLabelText(m.checkout.form.makeDefault));
      fireEvent.click(screen.getByRole("button", { name: m.checkout.form.save }));
      await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
      expect(calls.find((c) => c.method === "POST")!.body).toMatchObject({ phone: "+966551234567", cityCode: "riyadh", isDefault: true });

      await waitFor(() => expect(screen.queryByTestId("address-form")).toBeNull());
      fireEvent.click(screen.getByRole("button", { name: m.account.addresses.makeDefault }));
      await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
      expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ isDefault: true });

      fireEvent.click(screen.getAllByRole("button", { name: m.account.addresses.delete })[0]);
      expect(calls.some((c) => c.method === "DELETE")).toBe(false); // needs confirmation
      fireEvent.click(screen.getByRole("button", { name: m.account.addresses.confirmDelete }));
      await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
    });

    it(`PROF-02 · ADDRESS_LIMIT_REACHED is mapped to a localized message (${locale})`, async () => {
      login();
      mockApi((c) => {
        if (c.method === "GET") return { body: [addr(A1)] };
        return { status: 409, body: { code: "ADDRESS_LIMIT_REACHED", message: "english only" } };
      });
      wrap(locale, <AddressesPanel cities={cities} />);
      await screen.findAllByTestId("address-item");
      fireEvent.click(screen.getByRole("button", { name: m.account.addresses.edit }));
      // saving the edit hits the mocked 409
      fireEvent.click(screen.getByRole("button", { name: m.checkout.form.save }));
      expect((await screen.findByRole("alert")).textContent).toBe(m.errors.ADDRESS_LIMIT_REACHED);
    });
  });

  describe(`ORD-02 · order history (${locale})`, () => {
    it(`ORD-02 · lists my orders with a status chip and the API total (${locale})`, async () => {
      login();
      mockApi((c) =>
        c.path.startsWith("/orders")
          ? { body: { items: [order(), order({ id: "f".repeat(24), orderNo: "FX-20261123-0007", status: "DELIVERED" })], meta: { page: 1, limit: 10, total: 2, totalPages: 1 } } }
          : { status: 404 },
      );
      wrap(locale, <OrdersList />);
      const rows = await screen.findAllByTestId("order-row");
      expect(rows).toHaveLength(2);
      const chips = screen.getAllByTestId("status-chip").map((x) => x.textContent);
      expect(chips).toEqual([m.orderStatus.PENDING, m.orderStatus.DELIVERED]);
      expect(rows[0].textContent).toContain("2,050");
      expect(rows[0].getAttribute("href")).toBe(`/account/orders/${O1}`);
    });

    it(`ORD-02 · shows an empty state (${locale})`, async () => {
      login();
      mockApi(() => ({ body: { items: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } } }));
      wrap(locale, <OrdersList />);
      expect(await screen.findByText(m.account.orders.empty)).toBeTruthy();
    });

    it(`ORD-02 · detail shows items, address, totals and the status timeline in order (${locale})`, async () => {
      login();
      mockApi(() =>
        ({
          body: order({
            status: "CONFIRMED",
            statusHistory: [
              { status: "CONFIRMED", at: "2026-11-24T09:00:00.000Z" },
              { status: "PENDING", at: "2026-11-24T08:00:00.000Z" },
            ],
          }),
        }),
      );
      wrap(locale, <OrderDetail orderId={O1} />);
      await screen.findByTestId("order-detail");
      expect(screen.getByTestId("order-no").textContent).toBe("FX-20261124-0042");
      expect(screen.getByTestId("order-lines").textContent).toContain(locale === "ar" ? "أريكة بلوط" : "Oak sofa");
      expect(screen.getByTestId("order-total").textContent).toContain("2,050");
      expect(document.body.textContent).toContain("King Fahd Rd");
      const steps = Array.from(screen.getByTestId("timeline").querySelectorAll("li"));
      expect(steps).toHaveLength(2);
      expect(steps[0].textContent).toContain(m.orderStatus.PENDING);
      expect(steps[1].textContent).toContain(m.orderStatus.CONFIRMED);
      expect(screen.queryByTestId("cancel-order")).toBeNull();
    });

    it(`ORD-02 · a missing order shows a not-found message (${locale})`, async () => {
      login();
      mockApi(() => ({ status: 404, body: { code: "NOT_FOUND" } }));
      wrap(locale, <OrderDetail orderId={O1} />);
      expect((await screen.findByRole("alert")).textContent).toContain(m.account.orders.notFound);
    });
  });

  describe(`ORD-03 · cancel (${locale})`, () => {
    it(`ORD-03 · a PENDING order can be cancelled after confirming; the API order replaces the view (${locale})`, async () => {
      login();
      mockApi((c) =>
        c.path.endsWith("/cancel")
          ? { body: order({ status: "CANCELLED", statusHistory: [{ status: "PENDING", at: "2026-11-24T08:00:00.000Z" }, { status: "CANCELLED", at: "2026-11-24T08:30:00.000Z" }] }) }
          : { body: order() },
      );
      wrap(locale, <OrderDetail orderId={O1} />);
      fireEvent.click(await screen.findByTestId("cancel-order"));
      expect(calls.some((c) => c.method === "POST")).toBe(false);
      fireEvent.click(screen.getByTestId("cancel-confirm"));
      await waitFor(() => expect(screen.getByTestId("status-chip").textContent).toBe(m.orderStatus.CANCELLED));
      const post = calls.find((c) => c.method === "POST")!;
      expect(post.path).toBe(`/orders/${O1}/cancel`);
      expect(post.body).toBeUndefined();
      expect(screen.queryByTestId("cancel-order")).toBeNull();
    });

    it(`ORD-03 · the Cancel button is hidden for CONFIRMED and later (${locale})`, async () => {
      login();
      for (const status of ["CONFIRMED", "PROCESSING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"]) {
        mockApi(() => ({ body: order({ status }) }));
        const { unmount } = wrap(locale, <OrderDetail orderId={O1} />);
        await screen.findByTestId("order-detail");
        expect(screen.queryByTestId("cancel-order")).toBeNull();
        unmount();
      }
    });

    it(`ORD-03 · INVALID_TRANSITION (admin confirmed first) shows a localized message and the fresh status (${locale})`, async () => {
      login();
      let confirmed = false;
      mockApi((c) => {
        if (c.path.endsWith("/cancel")) {
          confirmed = true;
          return { status: 409, body: { code: "INVALID_TRANSITION", message: "english" } };
        }
        return { body: order({ status: confirmed ? "CONFIRMED" : "PENDING" }) };
      });
      wrap(locale, <OrderDetail orderId={O1} />);
      fireEvent.click(await screen.findByTestId("cancel-order"));
      fireEvent.click(screen.getByTestId("cancel-confirm"));
      expect((await screen.findByRole("alert")).textContent).toBe(m.errors.INVALID_TRANSITION);
      await waitFor(() => expect(screen.getByTestId("status-chip").textContent).toBe(m.orderStatus.CONFIRMED));
      expect(screen.queryByTestId("cancel-order")).toBeNull();
    });
  });

  describe(`PROF-01 · account guard (${locale})`, () => {
    it(`PROF-01 · a guest is sent to /login, an admin sees a notice (${locale})`, () => {
      useAuthStore.setState({ status: "anonymous", accessToken: null, user: null });
      wrap(locale, <AccountShell tab="profile"><p>secret</p></AccountShell>);
      expect(replace).toHaveBeenCalledWith("/login");
      expect(screen.queryByText("secret")).toBeNull();
      cleanup();
      login({ role: "ADMIN" });
      wrap(locale, <AccountShell tab="profile"><p>secret</p></AccountShell>);
      expect(screen.getByText(m.account.adminNotice)).toBeTruthy();
    });
  });
}
