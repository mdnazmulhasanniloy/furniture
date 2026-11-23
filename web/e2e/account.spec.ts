import { expect, test } from "@playwright/test";

// PROF-01 / PROF-02 / ORD-02 / ORD-03 — guests opening any account route are sent to login
// (no backend needed), in both locales, without horizontal overflow at 360px.
for (const locale of ["en", "ar"] as const) {
  for (const route of ["account", "account/addresses", "account/orders", `account/orders/${"a".repeat(24)}`]) {
    test(`PROF-01: guest on /${locale}/${route.slice(0, 22)} redirects to login`, async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(`/${locale}/${route}`);
      await page.waitForURL(new RegExp(`/${locale}/login$`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  }
}
