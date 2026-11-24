import { expect, test } from "@playwright/test";

// PROD-01 — shop page renders in both locales (backend absent: error state, filters still usable).
for (const locale of ["en", "ar"] as const) {
  test(`PROD-01: shop has no overflow at 360px and filter sheet opens in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}/shop?type=resale&condition=good`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator("#shop-filters")).toBeHidden();
    await page.locator('button[aria-controls="shop-filters"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`PROD-01: filter sidebar visible on desktop, sort keeps URL in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${locale}/shop?type=new`);
    await expect(page.locator("#shop-filters")).toBeVisible();
    await page.getByTestId("sort-toolbar").selectOption("price_asc");
    await expect(page).toHaveURL(/type=new/);
    await expect(page).toHaveURL(/sort=price_asc/);
  });
}
