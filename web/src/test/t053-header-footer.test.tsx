// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", path: "/" }));
const locales = { en, ar } as const;

vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async () => createTranslator({ locale: state.locale, messages: locales[state.locale] }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => state.path,
}));
vi.mock("next/navigation", () => ({ useParams: () => ({}) }));

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import type { SiteSettings } from "@/lib/api/public";

const settings: SiteSettings = {
  contactEmail: "hello@furnixa.example",
  contactPhone: "+966500000000",
  address: { en: "Riyadh", ar: "الرياض" },
  socials: { instagram: "https://instagram.com/furnixa", facebook: "http://insecure.example" },
  deliveryCities: [
    { code: "JED", name: { en: "Jeddah", ar: "جدة" }, isActive: true, sortOrder: 2 },
    { code: "RUH", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 1 },
    { code: "DMM", name: { en: "Dammam", ar: "الدمام" }, isActive: false, sortOrder: 3 },
  ],
};

afterEach(cleanup);

describe.each(["en", "ar"] as const)("UI-01 · header and footer v2 (%s)", (locale) => {
  const m = locales[locale];

  async function renderFooter(s: SiteSettings | null = settings) {
    state.locale = locale;
    const ui = await SiteFooter({ settings: s });
    return render(<NextIntlClientProvider locale={locale} messages={m}>{ui}</NextIntlClientProvider>);
  }

  it(`UI-01 · the footer is one emerald block with sand text (${locale})`, async () => {
    await renderFooter();
    const footer = screen.getByRole("contentinfo");
    expect(footer.className).toContain("bg-primary");
    expect(footer.className).toContain("text-secondary");
    expect(footer.className).not.toMatch(/shadow/);
    // the one decoration is a champagne hairline on top (ADR-018: decorative, never text)
    expect(footer.className).toContain("border-t-2");
    expect(footer.className).toContain("border-champagne");
    expect(footer.className).toContain("mt-[var(--band-gap)]");
  });

  it(`UI-04 · the header floats transparent over the hero and turns solid when the hero leaves the viewport, by IntersectionObserver (${locale})`, () => {
    state.path = "/";
    const hero = document.createElement("section");
    hero.setAttribute("data-hero", "");
    document.body.appendChild(hero);
    const seen: { cb: (e: { isIntersecting: boolean }[]) => void; options: IntersectionObserverInit; target: Element | null }[] = [];
    class FakeIO {
      target: Element | null = null;
      constructor(public cb: (e: { isIntersecting: boolean }[]) => void, public options: IntersectionObserverInit) {
        seen.push(this as never);
      }
      observe(el: Element) {
        this.target = el;
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    render(
      <NextIntlClientProvider locale={state.locale} messages={locales[state.locale]}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    const header = screen.getByTestId("site-header");
    expect(header.className).toContain("fixed");
    expect(header.className).toContain("bg-transparent"); // before any callback the hero is assumed visible
    expect(header.className).toContain("hdr-light");
    expect(seen).toHaveLength(1);
    expect(seen[0].target).toBe(hero); // it watches the hero, not the scroll position
    expect(seen[0].options.rootMargin).toMatch(/^-\d+px 0px 0px 0px$/); // the top edge is the header's bottom edge
    act(() => seen[0].cb([{ isIntersecting: false }])); // the hero scrolled out from under the header
    expect(header.className).toContain("bg-background");
    expect(header.className).toContain("border-border");
    expect(header.className).not.toContain("bg-transparent");
    expect(header.className).not.toContain("hdr-light");
    act(() => seen[0].cb([{ isIntersecting: true }])); // scrolled back to the top
    expect(header.className).toContain("bg-transparent");
    hero.remove();
    vi.unstubAllGlobals();
  });

  it(`UI-04 · with no hero on the page the home header is solid, never transparent over content (${locale})`, () => {
    state.path = "/";
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    render(
      <NextIntlClientProvider locale={state.locale} messages={locales[state.locale]}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("site-header").className).toContain("bg-background");
    vi.unstubAllGlobals();
  });

  it(`UI-04 · on every other page the header is the solid sticky header, even at the top (${locale})`, () => {
    state.path = "/shop";
    render(
      <NextIntlClientProvider locale={state.locale} messages={locales[state.locale]}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    const header = screen.getByTestId("site-header");
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("bg-background");
    expect(header.className).not.toContain("hdr-light");
    state.path = "/";
  });

  it(`UI-01 · the footer lists active cities in sort order, localized (${locale})`, async () => {
    await renderFooter();
    const cities = within(screen.getByTestId("footer-cities")).getAllByRole("listitem").map((li) => li.textContent);
    expect(cities).toEqual(locale === "en" ? ["Riyadh", "Jeddah"] : ["الرياض", "جدة"]);
  });

  it(`UI-01 · the footer says cash on delivery in one plain sentence (${locale})`, async () => {
    await renderFooter();
    expect(screen.getByTestId("footer-cod").textContent).toBe(m.footer.cod);
  });

  it(`UI-01 · the footer has contact, an ltr phone, https-only socials and a language switch (${locale})`, async () => {
    await renderFooter();
    expect(screen.getByRole("link", { name: "hello@furnixa.example" }).getAttribute("href")).toBe("mailto:hello@furnixa.example");
    expect(screen.getByRole("link", { name: "+966500000000" }).getAttribute("dir")).toBe("ltr");
    expect(screen.getByRole("link", { name: m.footer.socials.instagram })).toBeTruthy();
    expect(screen.queryByRole("link", { name: m.footer.socials.facebook })).toBeNull();
    expect(screen.getByTestId("footer-language-switcher")).toBeTruthy();
  });

  it(`UI-01 · the footer renders without settings and without cities (${locale})`, async () => {
    await renderFooter(null);
    expect(screen.getByRole("contentinfo")).toBeTruthy();
    expect(within(screen.getByTestId("footer-cities")).queryAllByRole("listitem")).toHaveLength(0);
  });

  it(`UI-01 · header: 64 px slim bar, wide search from md, search icon below md that opens the field (${locale})`, () => {
    render(
      <NextIntlClientProvider locale={locale} messages={m}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    const header = screen.getByRole("banner");
    expect(header.firstElementChild?.className).toContain("h-16");
    const search = screen.getAllByRole("search")[0];
    expect(search.className).toContain("max-w-xl");
    expect(search.className.split(" ")).toContain("hidden");
    expect(search.className).toContain("md:block");
    // Below md: the field is closed until the icon is pressed.
    expect(screen.queryByTestId("search-row")).toBeNull();
    const toggle = screen.getByTestId("search-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByTestId("search-row")).getByRole("search")).toBeTruthy();
  });

  it(`UI-01 · header links never wrap onto two lines, so "Pre-owned" stays on one (${locale})`, () => {
    render(
      <NextIntlClientProvider locale={locale} messages={m}>
        <SiteHeader categories={[{ id: "1", slug: "a", parentId: null, sortOrder: 0, isActive: true, name: { en: "A", ar: "أ" }, children: [] }]} />
      </NextIntlClientProvider>,
    );
    const nav = screen.getByRole("navigation", { name: m.nav.main });
    expect(nav.className).toContain("shrink-0");
    for (const el of [...nav.querySelectorAll("a"), screen.getByTestId("mega-trigger")]) {
      expect(el.className, el.textContent ?? "").toContain("whitespace-nowrap");
    }
  });

  it(`UI-01 · header icons are favourites, account and cart; no bell for guests (${locale})`, () => {
    render(
      <NextIntlClientProvider locale={locale} messages={m}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: m.nav.cart })).toBeTruthy();
    expect(screen.getByRole("link", { name: m.nav.login })).toBeTruthy();
    expect(screen.queryByTestId("notifications-bell")).toBeNull();
  });
});
