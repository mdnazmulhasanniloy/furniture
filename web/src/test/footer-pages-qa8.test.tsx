// @vitest-environment jsdom
// QA 2026-11-24 item 8: the footer links the policy pages by their own CMS titles, only when the page exists,
// and shows no contact line when the setting is empty.
import { cleanup, render, screen, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar", missing: [] as string[] }));
const locales = { en, ar } as const;

vi.mock("next-intl/server", () => ({
  getLocale: async () => state.locale,
  getTranslations: async () =>
    createTranslator({ locale: state.locale, messages: locales[state.locale] }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({ useParams: () => ({}) }));

const TITLES: Record<string, { en: string; ar: string }> = {
  about: { en: "About us", ar: "من نحن" },
  contact: { en: "Contact us", ar: "اتصل بنا" },
  faq: { en: "FAQ", ar: "الأسئلة الشائعة" },
  terms: { en: "Terms and conditions", ar: "الشروط والأحكام" },
  privacy: { en: "Privacy policy", ar: "سياسة الخصوصية" },
  returns: { en: "Return and refund policy", ar: "سياسة الإرجاع والاسترجاع" },
};

vi.mock("@/lib/api/public", async (orig) => ({
  ...(await orig<typeof import("@/lib/api/public")>()),
  getPage: async (slug: string) =>
    state.missing.includes(slug) || !TITLES[slug]
      ? { status: "not-found" }
      : { status: "ok", page: { slug, title: TITLES[slug], content: { en: "<p>x</p>", ar: "<p>x</p>" } } },
}));

import { SiteFooter } from "@/components/layout/site-footer";
import type { SiteSettings } from "@/lib/api/public";

const settings: SiteSettings = {
  contactEmail: "hello@furnixa.sa",
  contactPhone: "+966500000000",
  address: null,
  socials: null,
  deliveryCities: [{ code: "RUH", name: { en: "Riyadh", ar: "الرياض" }, isActive: true, sortOrder: 1 }],
};

const renderFooter = async (s: SiteSettings | null = settings) => {
  const ui = await SiteFooter({ settings: s });
  return render(
    <NextIntlClientProvider locale={state.locale} messages={locales[state.locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

beforeEach(() => {
  state.missing = [];
});
afterEach(cleanup);

for (const locale of ["en", "ar"] as const) {
  describe(`QA-8 · footer page links (${locale})`, () => {
    beforeEach(() => {
      state.locale = locale;
    });

    it("links terms, privacy and the return policy, with the page's own title and href", async () => {
      await renderFooter();
      for (const slug of ["terms", "privacy", "returns"] as const) {
        const link = screen.getByRole("link", { name: TITLES[slug][locale] });
        expect(link.getAttribute("href")).toBe(`/pages/${slug}`);
      }
      // the information pages are linked too
      for (const slug of ["about", "contact", "faq"] as const) {
        expect(screen.getByRole("link", { name: TITLES[slug][locale] })).toBeTruthy();
      }
    });

    it("a page that does not exist is not linked, so the footer has no dead link", async () => {
      state.missing = ["returns", "faq"];
      await renderFooter();
      expect(screen.queryByRole("link", { name: TITLES.returns![locale] })).toBeNull();
      expect(screen.queryByRole("link", { name: TITLES.faq![locale] })).toBeNull();
      expect(screen.getByRole("link", { name: TITLES.terms![locale] })).toBeTruthy();
      const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
      expect(hrefs).not.toContain("/pages/returns");
    });

    it("an empty contact email or phone shows no contact line at all", async () => {
      await renderFooter({ ...settings, contactEmail: "", contactPhone: "" });
      const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href") ?? "");
      expect(hrefs.some((h) => h.startsWith("mailto:"))).toBe(false);
      expect(hrefs.some((h) => h.startsWith("tel:"))).toBe(false);
      // and nothing placeholder-looking is printed
      expect(document.body.textContent).not.toMatch(/example\.com|\+966500000000|placeholder/i);
    });

    it("a contact email and phone that are set are still shown", async () => {
      await renderFooter();
      const contact = screen.getByRole("link", { name: "hello@furnixa.sa" });
      expect(contact.getAttribute("href")).toBe("mailto:hello@furnixa.sa");
      expect(screen.getByRole("link", { name: "+966500000000" }).getAttribute("href")).toBe(
        "tel:+966500000000",
      );
    });

    it("the page links sit in the explore column, in a stable order", async () => {
      await renderFooter();
      const heading = screen.getByRole("heading", { name: locales[locale].footer.explore });
      const list = heading.parentElement!.querySelector("ul")!;
      const names = within(list).getAllByRole("link").map((a) => a.textContent);
      expect(names.slice(-6)).toEqual(
        (["about", "contact", "faq", "terms", "privacy", "returns"] as const).map(
          (s) => TITLES[s][locale],
        ),
      );
    });
  });
}
