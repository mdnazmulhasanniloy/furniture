// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StaticPageView } from "@/components/pages/static-page";
import { getPage, type StaticPage } from "@/lib/api/public";
import { alternatesFor, localePath } from "@/lib/seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const page: StaticPage = {
  slug: "about",
  title: { en: "About us", ar: "من نحن" },
  content: { en: "<h2>Our story</h2><p>Hello <a href=\"/shop\">shop</a></p>", ar: "<h2>قصتنا</h2><p>مرحبا</p>" },
  metaTitle: { en: "About Furnixa", ar: "عن فورنيكسا" },
  metaDescription: { en: "Who we are", ar: "من نحن" },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ADM-08 · static page rendering", () => {
  for (const locale of ["en", "ar"] as const) {
    it(`ADM-08 · renders the stored HTML in ${locale} (RTL for ar)`, () => {
      document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
      render(<StaticPageView page={page} locale={locale} />);
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(locale === "ar" ? "من نحن" : "About us");
      const content = screen.getByTestId("static-page-content");
      expect(content.querySelector("h2")?.textContent).toBe(locale === "ar" ? "قصتنا" : "Our story");
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }

  it("ADM-08 · falls back to en when the locale content is empty", () => {
    render(<StaticPageView page={{ ...page, content: { en: "<p>EN only</p>", ar: "" } }} locale="ar" />);
    expect(screen.getByTestId("static-page-content").textContent).toBe("EN only");
  });
});

describe("ADM-08 · getPage", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  const mock = (res: Partial<Response> | Error) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      if (res instanceof Error) throw res;
      return res;
    });

  it("ADM-08 · ok result is tagged page:{slug}", async () => {
    mock({ ok: true, status: 200, json: async () => page });
    const r = await getPage("about");
    expect(r.status).toBe("ok");
    const init = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(init[0])).toContain("/api/v1/cms/pages/about");
    expect(init[1].next.tags).toEqual(["page:about"]);
  });
  it("ADM-08 · 404 is not-found, outage is error", async () => {
    mock({ ok: false, status: 404 });
    expect((await getPage("x")).status).toBe("not-found");
    mock({ ok: false, status: 500 });
    expect((await getPage("x")).status).toBe("error");
    mock(new Error("down"));
    expect((await getPage("x")).status).toBe("error");
  });
});

describe("NFR-03 · SEO helpers", () => {
  it("NFR-03 · hreflang alternates cover en, ar and x-default (ar)", () => {
    expect(alternatesFor("en", "/pages/about")).toEqual({
      canonical: "/en/pages/about",
      languages: { en: "/en/pages/about", ar: "/ar/pages/about", "x-default": "/ar/pages/about" },
    });
    expect(localePath("ar", "/")).toBe("/ar");
  });

  it("NFR-03 · robots points at the sitemap and hides private areas in both locales", () => {
    vi.stubEnv("STOREFRONT_URL", "https://furnixa.com/");
    const r = robots();
    expect(r.sitemap).toBe("https://furnixa.com/sitemap.xml");
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    const disallow = rules.disallow as string[];
    for (const l of ["en", "ar"]) {
      expect(disallow).toContain(`/${l}/account`);
      expect(disallow).toContain(`/${l}/checkout`);
    }
    expect(disallow).toContain("/api/");
  });

  it("NFR-03 · sitemap lists home, shop and products with en/ar alternates", async () => {
    vi.stubEnv("STOREFRONT_URL", "https://furnixa.com");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ slug: "oak-sofa" }], meta: {} }) })),
    );
    const s = await sitemap();
    expect(s.map((e) => e.url)).toEqual([
      "https://furnixa.com/ar",
      "https://furnixa.com/ar/shop",
      "https://furnixa.com/ar/shop/oak-sofa",
    ]);
    expect(s[2].alternates?.languages).toEqual({
      en: "https://furnixa.com/en/shop/oak-sofa",
      ar: "https://furnixa.com/ar/shop/oak-sofa",
    });
  });

  it("NFR-03 · sitemap still lists static routes when the API is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await sitemap()).length).toBe(2);
  });
});
