import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { ORDER_STATUSES } from "@/lib/orders";
import { PASSWORD_RULES } from "@/lib/password-policy";
import { ALL_SECTION_TYPES } from "@/lib/sections";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

/**
 * QA 2026-11-24 (B4). Two reported symptoms, one cause each:
 *  - "At least {{n}} characters" never interpolated, because this app configures i18next with single
 *    braces (`{n}`, like the storefront messages) while that one string used i18next's default `{{n}}`.
 *  - A `SHOP_THE_LOOK` home section printed the raw key `sections.type.SHOP_THE_LOOK`: the API can
 *    return that type (api-spec SectionType) but the admin had no label for it.
 * The tests below are written to fail on the whole class, not only on those two: no locale string may
 * use the wrong placeholder syntax, every key a page renders must exist in both locales, every member
 * of a union used as a dynamic key must have a label, and nothing rendered may show `{{...}}` or a
 * bare dotted key.
 */
const locales = { en, ar } as const;
const flatten = (value: unknown, prefix = "", out: Record<string, string> = {}) => {
  if (typeof value === "string") out[prefix] = value;
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
};
const FLAT = { en: flatten(en), ar: flatten(ar) } as const;
const placeholders = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();

/** A dotted lowercase-ish path, i.e. what i18next prints when a key is missing. */
const RAW_KEY = /\b[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_]+){1,4}\b/g;
const KNOWN_DOTTED = /^(?:\d|[a-z]+\.(?:webp|png|jpg|jpeg|svg|com|sa|test|net|org))/i;

describe("I18N-01 · the locale files cannot carry a placeholder this app never interpolates (B4)", () => {
  it.each(["en", "ar"] as const)("I18N-01 · %s uses {name}, never {{name}}", (loc) => {
    const raw = fs.readFileSync(path.resolve(__dirname, `../locales/${loc}.json`), "utf8");
    const offenders = [...raw.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]);
    expect(offenders, "i18next here is configured with prefix '{' and suffix '}'").toEqual([]);
  });

  const PLURAL = /\.(zero|one|two|few|many|other)$/;
  it("I18N-01 · every key carries the same placeholders in both locales", () => {
    // A plural form may leave the numeral out in one language ("دقيقتان" is "two minutes"), so those
    // keys only have to stay inside the variables their own group uses.
    const groupVars = (key: string) => {
      const group = key.replace(PLURAL, "");
      const vars = new Set<string>();
      for (const loc of ["en", "ar"] as const) {
        for (const [k, v] of Object.entries(FLAT[loc])) {
          if (k.replace(PLURAL, "") === group) placeholders(v).forEach((p) => vars.add(p!));
        }
      }
      return vars;
    };
    const mismatched = Object.keys(FLAT.en)
      .filter((k) => FLAT.ar[k] !== undefined)
      .filter((k) => {
        const [a, b] = [placeholders(FLAT.en[k]!), placeholders(FLAT.ar[k]!)];
        if (!PLURAL.test(k)) return a.join(",") !== b.join(",");
        const known = groupVars(k);
        return [...a, ...b].some((p) => !known.has(p!));
      });
    expect(mismatched).toEqual([]);
  });
});

describe("I18N-01 · every key the code asks for exists in both locales (B4)", () => {
  const files = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "test" ? [] : files(full);
      return /\.tsx?$/.test(e.name) ? [full] : [];
    });

  it("I18N-01 · literal t(\"...\") keys all resolve", () => {
    const missing: string[] = [];
    for (const file of files(path.resolve(__dirname, ".."))) {
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
        const key = m[1]!;
        for (const loc of ["en", "ar"] as const) {
          if (FLAT[loc][key] === undefined) missing.push(`${loc}: ${key} (${path.basename(file)})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  /** Unions used as `t(`prefix.${value}`)`: every member needs its own label. */
  it.each([
    ["sections.type", ALL_SECTION_TYPES],
    ["orders.status", ORDER_STATUSES],
    ["auth.rules", PASSWORD_RULES],
    ["products.status", ["DRAFT", "PUBLISHED", "ARCHIVED"]],
    ["products.type", ["NEW", "RESALE"]],
    ["products.condition", ["NEW", "LIKE_NEW", "GOOD", "FAIR"]],
    ["orders.payment", ["COD", "UNPAID", "PAID"]],
    ["customers.status", ["active", "blocked", "deleted"]],
  ] as const)("I18N-01 · %s has a label for every value", (prefix, values) => {
    const missing: string[] = [];
    for (const value of values) {
      for (const loc of ["en", "ar"] as const) {
        if (FLAT[loc][`${prefix}.${value}`] === undefined) missing.push(`${loc}: ${prefix}.${value}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------- rendered pages

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
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
const localized = { en: "Look", ar: "تنسيق" };
/** One section per type the API can return, so every label is exercised. */
const sections = ALL_SECTION_TYPES.map((type, i) => ({
  id: `s${i}`,
  type,
  title: localized,
  isVisible: true,
  sortOrder: i,
  config: {},
  updatedAt: "2026-11-20T10:00:00.000Z",
}));

/** The invite screen is for someone who is not signed in yet (it redirects when they are). */
let signedIn = true;
function stubApi() {
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const p = url.replace(/^.*\/api\/v1/, "");
      if (p === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (p === "/auth/refresh")
        return signedIn ? json({ accessToken: "at-1", user: adminUser }) : json({ code: "UNAUTHORIZED" }, 401);
      if (p === "/admin/home-sections") return json(sections);
      if (p === "/admin/banners") return json([]);
      if (p === "/admin/categories") return json([]);
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount(route: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

/** Nothing on screen may look like an untranslated key or an uninterpolated placeholder. */
function expectNoRawI18n(text: string, loc: Locale) {
  expect(text).not.toMatch(/\{\{|\}\}/);
  expect(text.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).toEqual([]);
  const keys = (text.match(RAW_KEY) ?? []).filter((candidate) => {
    if (KNOWN_DOTTED.test(candidate)) return false;
    // Only flag strings that really are keys of ours.
    return FLAT[loc][candidate] !== undefined || /^(nav|sections|orders|products|customers|settings|auth|admins|banners|errors)\./.test(candidate);
  });
  expect(keys).toEqual([]);
}

beforeEach(() => {
  authStore.clear();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  signedIn = true;
  stubApi();
});
afterEach(() => configureApiClient(null));

describe.each(["en", "ar"] as const)("I18N-01 · rendered admin pages show no raw keys (%s) (B4)", (locale) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("I18N-01 · the home sections page labels every section type", async () => {
    mount("/sections");
    await screen.findByRole("heading", { level: 1, name: locales[locale].sections.title });
    await waitFor(() => expect(screen.getAllByTestId("section-row")).toHaveLength(ALL_SECTION_TYPES.length));
    const body = document.body.textContent ?? "";
    for (const type of ALL_SECTION_TYPES) {
      expect(body).toContain(locales[locale].sections.type[type]);
    }
    expectNoRawI18n(body, locale);
  });

  it("I18N-01 · the invite screen's password rules are interpolated", async () => {
    signedIn = false; // the page sends a signed-in visitor to the dashboard
    mount("/accept-invite?email=new%40furnixa.test");
    const rules = await screen.findByTestId("password-rules");
    expect(rules.textContent).toContain(locales[locale].auth.rules.length.replace("{n}", "8"));
    expectNoRawI18n(document.body.textContent ?? "", locale);
  });
});
