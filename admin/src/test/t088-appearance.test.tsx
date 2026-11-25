import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { previewStyle, type ThemeTokens } from "@/lib/appearance";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * T-088 / ADM-16 (CR-010, ADR-017): Settings > Appearance. The presets, their names and their colours all
 * come from the API - this page holds no colour value - and each card previews itself with the preset's
 * variables set on its own container, so the dashboard does not retint while the owner browses.
 */
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

const tokens = (primary: string, over: Partial<ThemeTokens> = {}): ThemeTokens => ({
  primary,
  primaryForeground: "#ffffff",
  ring: primary,
  muted: "#efe9dd",
  secondary: "#efe9dd",
  mutedForeground: "#5c6360",
  stone: "#6b726f",
  border: "#e4e0d6",
  input: "#7d8a85",
  gold: "#b8913a",
  goldStrong: "#9c7a2e",
  price: "#7a5e22",
  blush: "#f7eeea",
  champagne: "#c8a96a",
  ...over,
});

const PRESETS = [
  { id: "emerald", name: { en: "Emerald", ar: "الزمرد" }, tokens: tokens("#0f4c45") },
  {
    id: "walnut",
    name: { en: "Walnut", ar: "الجوز" },
    tokens: tokens("#6b3f2a", { price: "#77491b", gold: "#c58e4e" }),
  },
  { id: "charcoal", name: { en: "Charcoal", ar: "الفحم" }, tokens: tokens("#2b3236") },
  { id: "sand", name: { en: "Sand", ar: "الرمل" }, tokens: tokens("#4d4430") },
  { id: "burgundy", name: { en: "Burgundy", ar: "العنابي" }, tokens: tokens("#6e1f2e") },
];

const SETTINGS = {
  storeName: { en: "Furnixa", ar: "فرنيكسا" },
  logo: null,
  contactEmail: "info@furnixa.test",
  contactPhone: "+966500000000",
  address: null,
  socials: null,
  deliveryFee: 0,
  freeDeliveryThreshold: null,
  vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
  currency: "SAR",
  deliveryCities: [
    { code: "riyadh", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 1, deliveryFee: null },
  ],
  defaultLocale: "ar",
  seo: null,
  updatedAt: "2026-11-25T10:00:00.000Z",
};

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let appearance: { themeId: string; presets: typeof PRESETS; themeUpdatedAt: string | null; updatedAt: string };
let failNext: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  failNext = null;
  appearance = {
    themeId: "emerald",
    presets: PRESETS,
    themeUpdatedAt: null,
    updatedAt: SETTINGS.updatedAt,
  };
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: adminUser });
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      if (path.startsWith("/admin/")) calls.push({ method, path, body });
      if (path === "/admin/settings/appearance" && method === "GET") return json(appearance);
      if (path === "/admin/settings/appearance" && method === "PATCH") {
        if (failNext) {
          const f = failNext;
          failNext = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        appearance = {
          ...appearance,
          themeId: (body as { themeId: string }).themeId,
          themeUpdatedAt: "2026-11-25T11:00:00.000Z",
          updatedAt: "2026-11-25T11:00:00.000Z",
        };
        return json(appearance);
      }
      if (path === "/admin/settings" && method === "GET") return json(SETTINGS);
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
  stubApi();
});
afterEach(() => configureApiClient(null));

const dict = { en, ar } as const;
const copy = (locale: Locale, key: keyof typeof en.settings.appearance) =>
  dict[locale].settings.appearance[key] as string;

/** Open Settings in the given locale and switch to the Appearance tab. */
async function openAppearance(locale: Locale = "en") {
  initI18n(locale);
  await setLocale(locale);
  mount();
  await screen.findByTestId("settings-form");
  fireEvent.click(screen.getByRole("tab", { name: dict[locale].settings.section.appearance }));
  await screen.findByTestId("theme-cards");
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("T-088 · previewStyle (pure)", () => {
  it("T-088 · a preset becomes the 14 CSS variables, and only #rrggbb values survive", () => {
    const style = previewStyle(PRESETS[1]!.tokens);
    expect(Object.keys(style).length).toBe(14);
    expect(style["--primary"]).toBe("#6b3f2a");
    expect(style["--gold-strong"]).toBe("#9c7a2e");
    expect(style["--muted-foreground"]).toBe("#5c6360");

    const dirty = previewStyle({ ...PRESETS[0]!.tokens, price: "red", gold: "#fff" });
    expect(dirty["--price"]).toBeUndefined();
    expect(dirty["--gold"]).toBeUndefined();
    expect(dirty["--primary"]).toBe("#0f4c45");
    expect(previewStyle(undefined)).toEqual({});
  });
});

describe("ADM-16 · the Appearance tab", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`ADM-16 · five cards with the API's own names, the applied one marked (${locale})`, async () => {
      await openAppearance(locale);
      const cards = screen.getAllByRole("radio");
      expect(cards.length).toBe(5);
      for (const p of PRESETS) {
        expect(screen.getByTestId(`theme-card-${p.id}`).textContent).toContain(p.name[locale]);
      }
      // The applied theme is marked and pre-selected, so the group always has exactly one choice.
      expect(screen.getByTestId("theme-active-emerald").textContent).toBe(copy(locale, "active"));
      expect(screen.queryByTestId("theme-active-walnut")).toBeNull();
      expect(screen.getByTestId("theme-card-emerald").getAttribute("aria-checked")).toBe("true");
      expect(cards.filter((c) => c.getAttribute("aria-checked") === "true").length).toBe(1);
      // Nothing to apply yet, and the swatches are labelled, never colour alone.
      expect((screen.getByTestId("theme-apply") as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId("theme-unchanged").textContent).toBe(copy(locale, "unchanged"));
      const swatches = within(screen.getByTestId("theme-card-walnut")).getByTestId("theme-swatches");
      expect(swatches.textContent).toContain(dict[locale].settings.appearance.swatch.price);
    });

    it(`ADM-16 · choosing a card and applying it sends the PATCH with expectedUpdatedAt (${locale})`, async () => {
      await openAppearance(locale);
      fireEvent.click(screen.getByTestId("theme-card-walnut"));
      expect(screen.getByTestId("theme-card-walnut").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByTestId("theme-card-emerald").getAttribute("aria-checked")).toBe("false");

      const apply = screen.getByTestId("theme-apply") as HTMLButtonElement;
      expect(apply.disabled).toBe(false);
      fireEvent.click(apply);

      await screen.findByTestId("theme-applied");
      expect(screen.getByTestId("theme-applied").textContent).toBe(copy(locale, "applied"));
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: "/admin/settings/appearance",
          body: { themeId: "walnut", expectedUpdatedAt: SETTINGS.updatedAt },
        },
      ]);
      // The applied badge moves, and there is nothing left to apply.
      await waitFor(() => expect(screen.getByTestId("theme-active-walnut")).toBeTruthy());
      expect(screen.queryByTestId("theme-active-emerald")).toBeNull();
      expect((screen.getByTestId("theme-apply") as HTMLButtonElement).disabled).toBe(true);
    });
  }

  it("ADM-16 · a preset's colours stay inside its own card", async () => {
    await openAppearance("en");
    const walnut = screen.getByTestId("theme-preview-walnut");
    const emerald = screen.getByTestId("theme-preview-emerald");
    expect(walnut.style.getPropertyValue("--primary")).toBe("#6b3f2a");
    expect(emerald.style.getPropertyValue("--primary")).toBe("#0f4c45");
    // The dashboard itself is untouched: no inline theme on <html> or <body>.
    expect(document.documentElement.getAttribute("style") ?? "").not.toContain("--primary");
    expect(document.body.getAttribute("style") ?? "").not.toContain("--primary");
  });

  it("ADM-16 · the arrow keys move the selection through the group", async () => {
    await openAppearance("en");
    const emerald = screen.getByTestId("theme-card-emerald");
    emerald.focus();
    fireEvent.keyDown(emerald, { key: "ArrowRight" });
    expect(screen.getByTestId("theme-card-walnut").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(screen.getByTestId("theme-card-walnut"));
    fireEvent.keyDown(screen.getByTestId("theme-card-walnut"), { key: "ArrowLeft" });
    expect(emerald.getAttribute("aria-checked")).toBe("true");
    // Only the chosen card is in the tab order (one stop for the whole group).
    expect(emerald.getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("theme-card-walnut").getAttribute("tabindex")).toBe("-1");
  });

  for (const locale of ["en", "ar"] as const) {
    it(`ADM-16 · a 409 offers a reload and never shows the API's English (${locale})`, async () => {
      await openAppearance(locale);
      failNext = { status: 409, code: "STALE_UPDATE" };
      fireEvent.click(screen.getByTestId("theme-card-charcoal"));
      fireEvent.click(screen.getByTestId("theme-apply"));

      const alert = await screen.findByTestId("appearance-stale");
      expect(alert.textContent).toContain(copy(locale, "stale"));
      expect(alert.textContent).not.toContain("Raw English API text");
      expect(within(alert).getByRole("button").textContent).toBe(copy(locale, "reload"));
      expect(screen.queryByTestId("theme-applied")).toBeNull();
      // Still on emerald: a refused write changes nothing here either.
      expect(screen.getByTestId("theme-active-emerald")).toBeTruthy();
    });
  }

  it("ADM-16 · any other failure is shown by code, not by the API's message", async () => {
    await openAppearance("en");
    failNext = { status: 422, code: "VALIDATION_ERROR" };
    fireEvent.click(screen.getByTestId("theme-card-sand"));
    fireEvent.click(screen.getByTestId("theme-apply"));
    const err = await screen.findByTestId("appearance-apply-error");
    expect(err.textContent).not.toContain("Raw English API text");
    expect(err.textContent?.trim().length).toBeGreaterThan(0);
    expect(screen.queryByTestId("appearance-stale")).toBeNull();
  });
});
