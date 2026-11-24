// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({ useParams: () => ({}) }));

import { SiteHeader } from "@/components/layout/site-header";
import { safeHttps } from "@/components/layout/site-footer";
import { useAuthStore } from "@/lib/auth/store";
import { pick } from "@/lib/pick";

const categories = [
  {
    id: "1", slug: "living", parentId: null, sortOrder: 0, isActive: true,
    name: { en: "Living room", ar: "غرفة المعيشة" },
    children: [
      { id: "2", slug: "sofas", parentId: "1", sortOrder: 0, isActive: true, name: { en: "Sofas", ar: "أرائك" } },
    ],
  },
];

const locales = { en, ar } as const;

function renderHeader(locale: "en" | "ar", cats = categories) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      <SiteHeader categories={cats} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  push.mockClear();
  useAuthStore.getState().clear();
});

describe.each(["en", "ar"] as const)("UI-02 · header (%s)", (locale) => {
  const m = locales[locale];

  it(`UI-02 · header shows nav, search, cart and login in ${locale}`, () => {
    renderHeader(locale);
    expect(screen.getByRole("link", { name: m.nav.shop })).toBeTruthy();
    expect(screen.getAllByRole("search").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: m.nav.cart }).getAttribute("href")).toBe("/cart");
    expect(screen.getByRole("link", { name: m.nav.login })).toBeTruthy();
    expect(screen.queryByTestId("notifications-bell")).toBeNull();
  });

  it(`UI-02 · bell and account menu appear only when logged in (${locale})`, () => {
    useAuthStore.getState().setSession({
      accessToken: "t",
      user: { id: "u", firstName: "A", lastName: "B", email: "a@b.c", role: "CUSTOMER", isVerified: true, isBlocked: false, preferredLocale: locale },
    });
    renderHeader(locale);
    expect(screen.getByRole("link", { name: m.nav.notifications })).toBeTruthy();
    expect(screen.getByTestId("account-menu")).toBeTruthy();
  });

  it(`UI-02 · mega-menu lists localized categories (${locale})`, () => {
    renderHeader(locale);
    fireEvent.click(screen.getByTestId("mega-trigger"));
    const panel = screen.getByTestId("mega-panel");
    expect(panel.textContent).toContain(pick(categories[0].name, locale));
    expect(panel.textContent).toContain(pick(categories[0].children![0].name, locale));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("mega-panel")).toBeNull();
  });

  it(`UI-02 · mobile nav sheet opens and closes with Escape (${locale})`, () => {
    renderHeader(locale);
    fireEvent.click(screen.getByTestId("mobile-nav-trigger"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it(`UI-02 · search submits to /shop?q= (${locale})`, () => {
    renderHeader(locale);
    const input = screen.getAllByRole("searchbox")[0];
    fireEvent.change(input, { target: { value: " sofa " } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/shop?q=sofa");
  });

  it(`UI-02 · a search of more than 6 words submits the first 6, with no message (${locale})`, () => {
    // The API refuses more than 6 words (422); the customer just gets the shorter search (owner 2026-11-24).
    renderHeader(locale);
    const input = screen.getAllByRole("searchbox")[0];
    expect((input as HTMLInputElement).maxLength).toBe(100);
    fireEvent.change(input, { target: { value: "oak dining table for six people with chairs" } });
    fireEvent.submit(input.closest("form")!);
    expect(push).toHaveBeenCalledWith("/shop?q=oak%20dining%20table%20for%20six%20people");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it(`UI-02 · empty categories hide the mega-menu (${locale})`, () => {
    renderHeader(locale, []);
    expect(screen.queryByTestId("mega-trigger")).toBeNull();
  });
});

describe("I18N-01 · shell helpers", () => {
  it("I18N-01 · pick uses the locale and falls back to en", () => {
    expect(pick({ en: "Sofa", ar: "أريكة" }, "ar")).toBe("أريكة");
    expect(pick({ en: "Sofa", ar: "" }, "ar")).toBe("Sofa");
    expect(pick(null, "en")).toBe("");
  });

  it("I18N-01 · footer social links accept only https URLs", () => {
    expect(safeHttps("https://instagram.com/x")).toBe("https://instagram.com/x");
    expect(safeHttps("javascript:alert(1)")).toBeNull();
    expect(safeHttps("http://x.com")).toBeNull();
    expect(safeHttps(null)).toBeNull();
  });

  it("I18N-01 · en and ar define the same layout-shell keys", () => {
    expect(Object.keys(en.footer).sort()).toEqual(Object.keys(ar.footer).sort());
    expect(Object.keys(en.nav).sort()).toEqual(Object.keys(ar.nav).sort());
  });
});
