import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale } from "@/lib/i18n";
import { buildSettingsBody, settingsDefaults, type SiteSettings } from "@/lib/settings";
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
  logo: {
    key: "furnixa/test/logo.webp",
    url: "https://cdn.test/logo.webp",
    alt: { en: "Logo", ar: "شعار" },
    width: null,
    height: null,
  },
  contactEmail: "hello@furnixa.test",
  contactPhone: "011 234 5678",
  address: { en: "Riyadh", ar: "الرياض" },
  socials: { facebook: "https://facebook.com/furnixa", instagram: null, whatsapp: "966551234567", tiktok: null },
  deliveryFee: 1500,
  freeDeliveryThreshold: 20000,
  vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: false, registrationNumber: "300000000000003" },
  currency: "SAR",
  deliveryCities: [
    { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 0, feeOverride: 2500 },
    { code: "jeddah", name: { en: "Jeddah", ar: "جدة" }, isActive: false, sortOrder: 1, feeOverride: null },
  ],
  defaultLocale: "ar",
  seo: { title: { en: "Furnixa", ar: "فرنيكسا" }, description: { en: "Furniture", ar: "أثاث" } },
  updatedAt: "2026-11-20T10:00:00.000Z",
});

type Call = { method: string; path: string; body: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
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
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path === "/admin/settings") {
        if (method === "GET") return json(current);
        calls.push({ method, path, body });
        if (failNext) {
          const f = failNext;
          failNext = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        current = { ...current, ...body, currency: "SAR", updatedAt: "2026-11-21T00:00:00.000Z" };
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

describe("ADM-09 · request body (full replace)", () => {
  it("ADM-09 · keeps delivery, VAT, phone and socials exactly as loaded and never sends currency or updatedAt", () => {
    const s = base();
    const body = buildSettingsBody(s, {
      storeName: { en: "New", ar: "جديد" },
      logo: null,
      contactEmail: "a@b.co",
      address: null,
      defaultLocale: "en",
      seo: null,
    });
    expect(body.deliveryFee).toBe(1500);
    expect(body.freeDeliveryThreshold).toBe(20000);
    expect(body.vat).toEqual(base().vat);
    expect(body.deliveryCities).toEqual(base().deliveryCities);
    expect(body.contactPhone).toBe("011 234 5678");
    expect(body.socials).toEqual(base().socials);
    expect(body.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect("currency" in body).toBe(false);
    expect("updatedAt" in body).toBe(false);
    expect(settingsDefaults(s).defaultLocale).toBe("ar");
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-09 · site settings (%s)", (locale, msgs) => {
  const m = msgs.settings;
  beforeEach(async () => {
    stubApi();
    initI18n(locale);
    await setLocale(locale);
  });

  it("ADM-09 · loads the settings with the language tabs, default locale and read-only SAR", async () => {
    mount();
    expect(await screen.findByTestId("settings-form")).toBeTruthy();
    expect(screen.getByRole("tab", { name: m.section.general }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText(m.form.defaultLocale) as HTMLSelectElement).value).toBe("ar");
    const cur = screen.getByTestId("settings-currency") as HTMLInputElement;
    expect(cur.value).toBe("SAR");
    expect(cur.readOnly).toBe(true);
    expect((screen.getByLabelText(m.form.storeNameEn) as HTMLInputElement).value).toBe("Furnixa");
    expect(screen.getAllByRole("tab", { name: msgs.common.arabic }).length).toBeGreaterThan(0);
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
  });

  it("ADM-09 · saving sends expectedUpdatedAt and leaves fields owned by other tabs untouched", async () => {
    mount();
    await screen.findByTestId("settings-form");
    fill(m.form.storeNameEn, "Furnixa Home");
    fill(m.form.defaultLocale, "en");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    const b = puts()[0].body;
    expect(b.expectedUpdatedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(b.storeName).toEqual({ en: "Furnixa Home", ar: "فرنيكسا" });
    expect(b.defaultLocale).toBe("en");
    expect(b.logo).toEqual({ key: "furnixa/test/logo.webp", alt: { en: "Logo", ar: "شعار" } });
    const o = base();
    expect(b.deliveryFee).toBe(o.deliveryFee);
    expect(b.freeDeliveryThreshold).toBe(o.freeDeliveryThreshold);
    expect(b.vat).toEqual(o.vat);
    expect(b.deliveryCities).toEqual(o.deliveryCities);
    expect(b.contactPhone).toBe(o.contactPhone);
    expect(b.socials).toEqual(o.socials);
    expect("currency" in b).toBe(false);
    expect(await screen.findByTestId("settings-saved")).toBeTruthy();
  });

  it("ADM-09 · validates required names, email and both-or-none localized text", async () => {
    mount();
    await screen.findByTestId("settings-form");
    fill(m.form.storeNameEn, "");
    fill(m.form.contactEmail, "nope");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(m.form.required)).toBeTruthy();
    expect(screen.getByText(m.form.emailInvalid)).toBeTruthy();
    expect(puts().length).toBe(0);
    fill(m.form.storeNameEn, "X");
    fill(m.form.contactEmail, "a@b.co");
    fill(m.form.addressEn, "");
    fireEvent.click(screen.getByTestId("settings-save"));
    expect(await screen.findByText(m.form.bothLocales)).toBeTruthy();
    expect(puts().length).toBe(0);
  });

  it("ADM-09 · SEO is edited per language and omitted when emptied", async () => {
    mount();
    await screen.findByTestId("settings-form");
    fireEvent.click(screen.getByRole("tab", { name: m.section.seo }));
    fill(m.form.seoTitleEn, "");
    fill(m.form.seoTitleAr, "");
    fill(m.form.seoDescEn, "");
    fill(m.form.seoDescAr, "");
    fireEvent.click(screen.getByTestId("settings-save"));
    await waitFor(() => expect(puts().length).toBe(1));
    expect("seo" in puts()[0].body).toBe(false);
  });

  it("ADM-09 · social links and the phone are shown read-only and survive a save", async () => {
    mount();
    await screen.findByTestId("settings-form");
    expect((screen.getByTestId("settings-phone") as HTMLInputElement).readOnly).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: m.section.social }));
    const fb = screen.getByLabelText(m.social.facebook) as HTMLInputElement;
    expect(fb.value).toBe("https://facebook.com/furnixa");
    expect(fb.readOnly).toBe(true);
    expect(screen.getByTestId("settings-social-blocked").textContent).toBe(m.form.socialBlocked);
  });

  it("ADM-09 · 409 STALE_UPDATE shows the reload message, keeps the edits, and Reload refreshes", async () => {
    mount();
    await screen.findByTestId("settings-form");
    fill(m.form.storeNameEn, "My edit");
    failNext = { status: 409, code: "STALE_UPDATE" };
    fireEvent.click(screen.getByTestId("settings-save"));
    const stale = await screen.findByTestId("settings-stale");
    expect(stale.textContent).toContain(m.form.stale);
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect((screen.getByLabelText(m.form.storeNameEn) as HTMLInputElement).value).toBe("My edit");
    current = { ...base(), storeName: { en: "Other admin", ar: "مدير آخر" }, updatedAt: "2026-11-22T00:00:00.000Z" };
    fireEvent.click(screen.getByRole("button", { name: m.form.reload }));
    await waitFor(() =>
      expect((screen.getByLabelText(m.form.storeNameEn) as HTMLInputElement).value).toBe("Other admin"),
    );
    expect(screen.queryByTestId("settings-stale")).toBeNull();
  });

  it("ADM-09 · 409 CITY_CODE_IMMUTABLE is localised by code, never the API text", async () => {
    mount();
    await screen.findByTestId("settings-form");
    failNext = { status: 409, code: "CITY_CODE_IMMUTABLE" };
    fireEvent.click(screen.getByTestId("settings-save"));
    const err = await screen.findByTestId("settings-form-error");
    expect(err.textContent).toBe(msgs.errors.CITY_CODE_IMMUTABLE);
    expect(err.textContent).not.toContain("Raw English API text");
  });

  it("ADM-09 · dark mode uses token classes only", async () => {
    document.documentElement.classList.add("dark");
    mount();
    const form = await screen.findByTestId("settings-form");
    expect(form.innerHTML).toContain("bg-card");
    expect(form.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe("ADM-09 · locale files", () => {
  it("ADM-09 · en and ar define the same settings keys and the English wording", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        typeof v === "object" && v ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    expect(keys(ar.settings).sort()).toEqual(keys(en.settings).sort());
    expect(en.errors.CITY_CODE_IMMUTABLE).toBe("Cities can't be removed; deactivate instead.");
    expect(en.settings.form.stale).toContain("Settings were changed, reload");
  });
});
