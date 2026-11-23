import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { halalasToSar, parseSar, slugify, uniqueCode } from "@/lib/delivery";
import { initI18n, setLocale } from "@/lib/i18n";
import type { SiteSettings } from "@/lib/settings";
import { ThemeProvider } from "@/lib/theme";
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
  vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: false, registrationNumber: "300000000000003" },
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

function stubApi() {
  calls = [];
  current = base();
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
const fmt = (s: string, name: string) => s.replace("{name}", name);

describe("ADM-14 · SAR entry converts to halalas without rounding", () => {
  it("ADM-14 · parses SAR with at most 2 decimals and rejects negatives and extra decimals", () => {
    expect(parseSar("15")).toEqual({ ok: true, halalas: 1500 });
    expect(parseSar("15.5")).toEqual({ ok: true, halalas: 1550 });
    expect(parseSar(" 0.05 ")).toEqual({ ok: true, halalas: 5 });
    expect(parseSar("0")).toEqual({ ok: true, halalas: 0 });
    expect(parseSar("-1")).toEqual({ ok: false, reason: "negative" });
    expect(parseSar("1.234")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("abc")).toEqual({ ok: false, reason: "invalid" });
    expect(parseSar("")).toEqual({ ok: false, reason: "invalid" });
    expect(halalasToSar(1500)).toBe("15");
    expect(halalasToSar(2550)).toBe("25.50");
    expect(halalasToSar(5)).toBe("0.05");
  });

  it("ADM-13 · new city codes are slugs, unique among existing codes", () => {
    expect(slugify("Al Khobar!")).toBe("al-khobar");
    expect(slugify("الطائف")).toBe("");
    expect(uniqueCode("riyadh", ["Riyadh", "riyadh-2"])).toBe("riyadh-3");
    expect(uniqueCode("", [])).toBe("");
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-13 / ADM-14 · Settings Delivery (%s)", (locale, msgs) => {
  const m = msgs.settings;
  const d = m.delivery;
  const openDelivery = async () => {
    mount();
    await screen.findByTestId("settings-form");
    fireEvent.click(screen.getByRole("tab", { name: m.section.delivery }));
  };
  beforeEach(async () => {
    stubApi();
    initI18n(locale);
    await setLocale(locale);
  });

  it("ADM-14 · shows fee and threshold in SAR and the cities with code, override and active state", async () => {
    await openDelivery();
    expect((screen.getByLabelText(d.baseFee) as HTMLInputElement).value).toBe("15");
    expect((screen.getByLabelText(d.threshold) as HTMLInputElement).value).toBe("200");
    const rowsEls = screen.getAllByTestId("city-row");
    expect(rowsEls.map((r) => r.getAttribute("data-code"))).toEqual(["riyadh", "jeddah"]);
    expect((within(rowsEls[0]).getByTestId("city-code") as HTMLInputElement).readOnly).toBe(true);
    expect((screen.getByLabelText(fmt(d.cityFee, "riyadh")) as HTMLInputElement).value).toBe("25.50");
    expect((screen.getByLabelText(fmt(d.cityFee, "jeddah")) as HTMLInputElement).value).toBe("");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.queryByRole("button", { name: /delete|حذف/i })).toBeNull();
  });

  it("ADM-14 · saving converts SAR to halalas and an empty threshold and empty override save null", async () => {
    await openDelivery();
    fill(d.baseFee, "20.5");
    fill(d.threshold, "");
    fill(fmt(d.cityFee, "riyadh"), "");
    fill(fmt(d.cityFee, "jeddah"), "30");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const b = puts()[0].body;
    expect(b.deliveryFee).toBe(2050);
    expect(b.freeDeliveryThreshold).toBeNull();
    expect(b.deliveryCities[0].deliveryFee).toBeNull();
    expect(b.deliveryCities[1].deliveryFee).toBe(3000);
    expect(b.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(await screen.findByTestId("settings-saved")).toBeTruthy();
  });

  it("ADM-14 · negative or too-precise amounts are rejected and nothing is sent", async () => {
    await openDelivery();
    fill(d.baseFee, "-5");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(d.negative)).toBeTruthy();
    fill(d.baseFee, "5.123");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(d.invalidAmount)).toBeTruthy();
    fill(d.baseFee, "5");
    fill(d.threshold, "abc");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(screen.getAllByText(d.invalidAmount).length).toBeGreaterThan(0));
    fill(d.threshold, "");
    fill(fmt(d.cityFee, "riyadh"), "-1");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(d.cityError.negative)).toBeTruthy();
    expect(puts().length).toBe(0);
  });

  it("ADM-13 · add city needs both names, creates a unique code and sends sortOrder in row order", async () => {
    await openDelivery();
    fireEvent.click(screen.getByTestId("city-add"));
    fireEvent.click(screen.getByTestId("city-add-confirm"));
    expect(screen.getAllByText(m.form.required).length).toBe(2);
    fireEvent.change(screen.getByLabelText(d.nameEn), { target: { value: "Riyadh" } });
    fireEvent.change(screen.getByLabelText(d.nameAr), { target: { value: "الرياض الجديدة" } });
    fireEvent.click(screen.getByTestId("city-add-confirm"));
    expect(screen.queryByTestId("city-dialog")).toBeNull();
    expect(screen.getAllByTestId("city-row").map((r) => r.getAttribute("data-code"))).toEqual([
      "riyadh",
      "jeddah",
      "riyadh-2",
    ]);
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const cities = puts()[0].body.deliveryCities;
    expect(cities.map((c: { code: string; sortOrder: number }) => [c.code, c.sortOrder])).toEqual([
      ["riyadh", 0],
      ["jeddah", 1],
      ["riyadh-2", 2],
    ]);
    expect(cities[2]).toMatchObject({ isActive: true, deliveryFee: null, name: { en: "Riyadh", ar: "الرياض الجديدة" } });
  });

  it("ADM-13 · renames keep the code, and move buttons reorder", async () => {
    await openDelivery();
    fill(fmt(d.cityNameEn, "jeddah"), "Jiddah");
    fireEvent.click(screen.getByRole("button", { name: fmt(d.moveUp, "jeddah") }));
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const cities = puts()[0].body.deliveryCities;
    expect(cities.map((c: { code: string }) => c.code)).toEqual(["jeddah", "riyadh"]);
    expect(cities[0]).toMatchObject({ code: "jeddah", sortOrder: 0, name: { en: "Jiddah", ar: "جدة" } });
  });

  it("ADM-13 · the last active city cannot be turned off, shows a hint, and there is no delete action", async () => {
    await openDelivery();
    const riyadh = screen.getByRole("switch", { name: fmt(d.toggleActive, "riyadh") }) as HTMLButtonElement;
    const jeddah = screen.getByRole("switch", { name: fmt(d.toggleActive, "jeddah") }) as HTMLButtonElement;
    expect(riyadh.disabled).toBe(true);
    expect(screen.getByTestId("city-last-active").textContent).toBe(d.lastActive);
    fireEvent.click(jeddah);
    expect(jeddah.getAttribute("aria-checked")).toBe("true");
    expect(riyadh.disabled).toBe(false);
    expect(screen.queryByTestId("city-last-active")).toBeNull();
    fireEvent.click(riyadh);
    expect(riyadh.getAttribute("aria-checked")).toBe("false");
    expect(jeddah.disabled).toBe(true);
  });

  it("ADM-13 · both city names are required on save", async () => {
    await openDelivery();
    fill(fmt(d.cityNameAr, "jeddah"), " ");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(d.cityError.name)).toBeTruthy();
    expect(puts().length).toBe(0);
  });

  it("ADM-14 · saving keeps General, SEO, VAT, phone and socials untouched and sends no currency", async () => {
    await openDelivery();
    fill(d.baseFee, "16");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const b = puts()[0].body;
    const o = base();
    expect(b.deliveryFee).toBe(1600);
    expect(b.storeName).toEqual(o.storeName);
    expect(b.contactEmail).toBe(o.contactEmail);
    expect(b.address).toEqual(o.address);
    expect(b.seo).toEqual(o.seo);
    expect(b.vat).toEqual(o.vat);
    expect(b.contactPhone).toBe(o.contactPhone);
    expect(b.socials).toEqual(o.socials);
    expect(b.defaultLocale).toBe("ar");
    expect("currency" in b).toBe(false);
    expect(b.freeDeliveryThreshold).toBe(20000);
    expect(b.deliveryCities).toEqual(o.deliveryCities);
  });

  it("ADM-13 · 409 CITY_CODE_IMMUTABLE and STALE_UPDATE are localised and keep the edits", async () => {
    await openDelivery();
    fill(d.baseFee, "17");
    failNext = { status: 409, code: "CITY_CODE_IMMUTABLE" };
    fireEvent.click(screen.getByTestId("settings-save"));
    expect((await screen.findByTestId("settings-form-error")).textContent).toBe(msgs.errors.CITY_CODE_IMMUTABLE);
    failNext = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(screen.getByTestId("settings-save"));
    expect((await screen.findByTestId("settings-stale")).textContent).toContain(m.form.stale);
    expect((screen.getByLabelText(d.baseFee) as HTMLInputElement).value).toBe("17");
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-14 · dark mode uses token classes only", async () => {
    document.documentElement.classList.add("dark");
    await openDelivery();
    const html = screen.getByTestId("city-list").innerHTML;
    expect(html).toContain("bg-card");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
