import { expect, test } from "@playwright/test";

// CART-01 — the cart page renders the empty state (guest, no backend needed) in both locales
// without horizontal overflow at 360px.
for (const locale of ["en", "ar"] as const) {
  test(`CART-01: guest cart page shows the empty state in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}/cart`);
    await expect(page.getByTestId("cart-empty")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}
