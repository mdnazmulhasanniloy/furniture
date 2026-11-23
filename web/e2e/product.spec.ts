import { expect, test } from "@playwright/test";

// PROD-02 — with no backend the unknown slug yields the 404 / error state, never a crash.
for (const locale of ["en", "ar"] as const) {
  test(`PROD-02: product page degrades without overflow at 360px in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const res = await page.goto(`/${locale}/shop/does-not-exist`);
    expect([200, 404]).toContain(res?.status());
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
