import { expect, test } from "@playwright/test";

// ORD-01 / PROF-02 — a guest opening /checkout is sent to the login screen (no backend needed),
// in both locales, without horizontal overflow at 360px.
for (const locale of ["en", "ar"] as const) {
  test(`ORD-01: guest checkout redirects to login in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}/checkout`);
    await page.waitForURL(new RegExp(`/${locale}/login$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}
