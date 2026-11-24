import { expect, test } from "@playwright/test";

// ADM-08 / NFR-03 — no backend in e2e: an unknown page degrades (404/error), never a crash;
// robots and sitemap are served.
for (const locale of ["en", "ar"] as const) {
  test(`ADM-08: unknown static page degrades at 360px in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const res = await page.goto(`/${locale}/pages/does-not-exist`);
    expect([200, 404]).toContain(res?.status());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`NFR-03: /${locale} carries hreflang alternates`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const langs = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((els) =>
      els.map((e) => e.getAttribute("hreflang")),
    );
    expect(langs).toEqual(expect.arrayContaining(["en", "ar", "x-default"]));
  });
}

test("NFR-03: robots.txt and sitemap.xml are served", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap:");
  const sm = await request.get("/sitemap.xml");
  expect(sm.status()).toBe(200);
  expect(await sm.text()).toContain("/ar/shop");
});
