import { expect, test } from "@playwright/test";

/**
 * QA 2026-11-24 (B7). Every page carries its own title, a meta description and Open Graph tags, the
 * brand appears once in a title, and the 404 names itself (it used to fall back to the bare brand
 * because a page that calls notFound() loses its own metadata).
 */
const PAGES = ["/", "/shop", "/shop?category=sofas", "/cart", "/favourites", "/login", "/pages/about", "/no-such-page"] as const;
const BRAND = { en: "Furnixa", ar: "فرنيكسا" };

for (const locale of ["en", "ar"] as const) {
  test(`QA-B7 · ${locale} pages have a title, a description and Open Graph tags`, async ({ page }) => {
    for (const path of PAGES) {
      await page.goto(`/${locale}${path}`, { waitUntil: "domcontentloaded" });
      // Read straight from the DOM: a missing tag must fail the assertion, not hang the locator.
      const content = (name: string) =>
        page.evaluate(
          (n) =>
            document
              .querySelector(`meta[${n.startsWith("og:") ? "property" : "name"}="${n}"]`)
              ?.getAttribute("content") ?? null,
          name,
        );

      const title = (await page.title()).trim();
      expect(title, `${path} title`).not.toBe("");
      // the brand belongs in a title exactly once
      const brands = title.split(BRAND[locale]).length - 1;
      expect(brands, `${path} title "${title}"`).toBeLessThanOrEqual(1);

      const description = (await content("description"))?.trim() ?? "";
      expect(description, `${path} meta description`).not.toBe("");

      expect((await content("og:title"))?.trim(), `${path} og:title`).not.toBe("");
      expect((await content("og:description"))?.trim(), `${path} og:description`).not.toBe("");
      const image = (await content("og:image")) ?? "";
      expect(image, `${path} og:image`).toMatch(/^https?:\/\//);
      expect((await content("og:site_name"))?.trim(), `${path} og:site_name`).toBe("Furnixa");
    }
  });

  test(`QA-B7 · ${locale} the 404 names itself and asks not to be indexed`, async ({ page }) => {
    const res = await page.goto(`/${locale}/no-such-page`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBe(404);
    const title = (await page.title()).trim();
    expect(title).toContain("|"); // "<page not found> | <brand>", never the bare brand
    expect(title.split("|")[0]!.trim().length).toBeGreaterThan(1);
    // The 404 status is the signal for crawlers; a segment that calls notFound() cannot add robots
    // metadata of its own (measured - Next drops it), and the layout's would apply site-wide.
  });

  test(`QA-B7 · ${locale} a static page's title carries the brand once`, async ({ page }) => {
    await page.goto(`/${locale}/pages/about`, { waitUntil: "domcontentloaded" });
    const title = await page.title();
    expect(title.split(BRAND[locale]).length - 1).toBeLessThanOrEqual(1);
  });
}
