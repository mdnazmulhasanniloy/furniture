import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale } from "@/lib/i18n";
import type { SiteSettings } from "@/lib/settings";
import { ThemeProvider } from "@/lib/theme";
import { exampleVat, isRegistrationNumber, parseRate, rateToText } from "@/lib/vat";
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

const base = (): SiteSettings => ({
  storeName: { en: "Furnixa", ar: "فرنيكسا" },
  logo: null,
  contactEmail: "hello@furnixa.test",
  contactPhone: "011 234 5678",
  address: { en: "Riyadh", ar: "الرياض" },
  socials: { facebook: "https://facebook.com/furnixa", instagram: null, whatsapp: null, tiktok: null },
  deliveryFee: 1500,
  freeDeliveryThreshold: 20000,
  vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
  currency: "SAR",
  deliveryCities: [
    { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 0, deliveryFee: 2550 },
    { code: "jeddah", name: { en: "Jeddah", ar: "جدة" }, isActive: false, sortOrder: 1, deliveryFee: null },
  ],
  defaultLocale: "ar",
  seo: { title: { en: "Furnixa", ar: "فرنيكسا" }, description: { en: "Furniture", ar: "أثاث" } },
  updatedAt: "2026-11-20T10:00:00.000Z",
});

type Call = { method: string; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[] = [];
let current = base();
let failNext: { status: number; code: string } | null = null;

function stubApi(initial: SiteSettings = base()) {
  calls = [];
  current = initial;
  failNext = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      if (path === "/admin/settings") {
        if (method === "GET") return json(current);
        calls.push({ method, body: JSON.parse(String(init?.body)) });
        if (failNext) {
          const f = failNext;
          failNext = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        current = { ...current, ...JSON.parse(String(init?.body)), currency: "SAR", updatedAt: "2026-11-21T00:00:00.000Z" };
        return json(current);
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/settings"]}>
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

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const puts = () => calls.filter((c) => c.method === "PUT");

describe("ADM-14 · VAT helpers", () => {
  it("ADM-14 · parses the rate as percent with at most 2 decimals, 0-50, never rounding", () => {
    expect(parseRate("15")).toEqual({ ok: true, bp: 1500 });
    expect(parseRate("7.5")).toEqual({ ok: true, bp: 750 });
    expect(parseRate("0.07")).toEqual({ ok: true, bp: 7 });
    expect(parseRate("0")).toEqual({ ok: true, bp: 0 });
    expect(parseRate("50")).toEqual({ ok: true, bp: 5000 });
    expect(parseRate("50.00")).toEqual({ ok: true, bp: 5000 });
    expect(parseRate("50.01")).toEqual({ ok: false, reason: "range" });
    expect(parseRate("51")).toEqual({ ok: false, reason: "range" });
    expect(parseRate("15.123")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRate("-1")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRate("")).toEqual({ ok: false, reason: "invalid" });
    expect(parseRate("1e1")).toEqual({ ok: false, reason: "invalid" });
    expect(rateToText(15)).toBe("15");
    expect(rateToText(7.5)).toBe("7.5");
    expect(rateToText(0.07)).toBe("0.07");
    expect(rateToText(0)).toBe("0");
  });

  it("ADM-14 · registration number is 15 digits that start and end with 3", () => {
    expect(isRegistrationNumber("300000000000003")).toBe(true);
    expect(isRegistrationNumber("310122393500003")).toBe(true);
    expect(isRegistrationNumber("30000000000003")).toBe(false);
    expect(isRegistrationNumber("3000000000000033")).toBe(false);
    expect(isRegistrationNumber("200000000000003")).toBe(false);
    expect(isRegistrationNumber("300000000000002")).toBe(false);
    expect(isRegistrationNumber("30000000000000a")).toBe(false);
  });

  it("ADM-14 · the example uses the ADR-009 half-up formulas (15% on 125 SAR: 16.30 incl, 18.75 excl)", () => {
    expect(exampleVat(1500, true, 12500)).toBe(1630);
    expect(exampleVat(1500, false, 12500)).toBe(1875);
    expect(exampleVat(1500, true)).toBe(1304);
    expect(exampleVat(1500, false)).toBe(1500);
    expect(exampleVat(0, true)).toBe(0);
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-14 · Settings VAT (%s)", (locale, msgs) => {
  const m = msgs.settings;
  const v = m.vat;
  const openVat = async () => {
    mount();
    await screen.findByTestId("settings-form");
    fireEvent.click(screen.getByRole("tab", { name: m.section.vat }));
  };
  const sw = (label: string) => screen.getByRole("switch", { name: label }) as HTMLButtonElement;
  beforeEach(async () => {
    stubApi();
    initI18n(locale);
    await setLocale(locale);
  });

  it("ADM-14 · default state shows rate 0, no example VAT, and the delivery switch disabled", async () => {
    await openVat();
    expect((screen.getByLabelText(v.rate) as HTMLInputElement).value).toBe("0");
    expect(sw(v.applyDelivery).disabled).toBe(true);
    expect(sw(v.applyDelivery).getAttribute("aria-checked")).toBe("true");
    expect(sw(v.pricesInclude).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("vat-example").textContent).toBe(v.exampleNone);
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.getByText(v.existingOrders)).toBeTruthy();
  });

  it("ADM-14 · missing vat object on the loaded settings shows the documented defaults", async () => {
    const s = base() as Partial<SiteSettings>;
    delete s.vat;
    stubApi(s as SiteSettings);
    await openVat();
    expect((screen.getByLabelText(v.rate) as HTMLInputElement).value).toBe("0");
    expect(sw(v.pricesInclude).getAttribute("aria-checked")).toBe("true");
  });

  it("ADM-14 · toggles and rate persist: saves percent, switches and the registration number", async () => {
    await openVat();
    fill(v.rate, "15");
    expect(sw(v.applyDelivery).disabled).toBe(false);
    fireEvent.click(sw(v.applyDelivery));
    fireEvent.click(sw(v.pricesInclude));
    fill(v.number, "300000000000003");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    expect(puts()[0].body.vat).toEqual({
      vatRate: 15,
      applyToDelivery: false,
      pricesIncludeVat: false,
      registrationNumber: "300000000000003",
    });
    expect(puts()[0].body.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(await screen.findByTestId("settings-saved")).toBeTruthy();
  });

  it("ADM-14 · the live example follows the rate and the includes-VAT switch", async () => {
    await openVat();
    fill(v.rate, "15");
    const ex = () => screen.getByTestId("vat-example").textContent ?? "";
    expect(ex()).toContain("13.04");
    fireEvent.click(sw(v.pricesInclude));
    expect(ex()).toContain("15");
    expect(ex()).not.toContain("13.04");
    fill(v.rate, "0");
    expect(ex()).toBe(v.exampleNone);
  });

  it("ADM-14 · invalid or out-of-range rate and invalid registration number are rejected, nothing is sent", async () => {
    await openVat();
    fill(v.rate, "51");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(v.rateRange)).toBeTruthy();
    fill(v.rate, "15.123");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(v.rateInvalid)).toBeTruthy();
    fill(v.rate, "-5");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(screen.getAllByText(v.rateInvalid).length).toBeGreaterThan(0));
    fill(v.rate, "15");
    fill(v.number, "12345");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(v.numberInvalid)).toBeTruthy();
    expect(puts().length).toBe(0);
  });

  it("ADM-14 · an error on the VAT tab opens that tab from another tab", async () => {
    await openVat();
    fill(v.rate, "99");
    fireEvent.click(screen.getByRole("tab", { name: m.section.general }));
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(v.rateRange)).toBeTruthy();
    expect(screen.getByRole("tab", { name: m.section.vat }).getAttribute("aria-selected")).toBe("true");
  });

  it("ADM-14 · an empty registration number saves null and the switch values are kept at rate 0", async () => {
    await openVat();
    fireEvent.click(sw(v.pricesInclude));
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    expect(puts()[0].body.vat).toEqual({
      vatRate: 0,
      applyToDelivery: true,
      pricesIncludeVat: false,
      registrationNumber: null,
    });
  });

  it("ADM-14 · saving VAT keeps General, Delivery, SEO, phone and socials untouched and sends no currency", async () => {
    await openVat();
    fill(v.rate, "7.5");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const b = puts()[0].body;
    const o = base();
    expect(b.vat.vatRate).toBe(7.5);
    expect(b.storeName).toEqual(o.storeName);
    expect(b.contactEmail).toBe(o.contactEmail);
    expect(b.address).toEqual(o.address);
    expect(b.seo).toEqual(o.seo);
    expect(b.contactPhone).toBe(o.contactPhone);
    expect(b.socials).toEqual(o.socials);
    expect(b.defaultLocale).toBe("ar");
    expect(b.deliveryFee).toBe(o.deliveryFee);
    expect(b.freeDeliveryThreshold).toBe(o.freeDeliveryThreshold);
    expect(b.deliveryCities).toEqual(o.deliveryCities);
    expect("currency" in b).toBe(false);
  });

  it("ADM-14 · STALE_UPDATE is localised, keeps the edits and never shows the API text", async () => {
    await openVat();
    fill(v.rate, "12");
    failNext = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(screen.getByTestId("settings-save"));
    expect((await screen.findByTestId("settings-stale")).textContent).toContain(m.form.stale);
    expect((screen.getByLabelText(v.rate) as HTMLInputElement).value).toBe("12");
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-14 · a VALIDATION_ERROR from the API is shown localised", async () => {
    await openVat();
    fill(v.rate, "12");
    failNext = { status: 422, code: "VALIDATION_ERROR" };
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByTestId("settings-form-error")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-14 · dark mode uses token classes only", async () => {
    document.documentElement.classList.add("dark");
    await openVat();
    const html = screen.getByTestId("vat-example").parentElement?.innerHTML ?? "";
    expect(html).toContain("bg-card");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
