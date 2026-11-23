import { expect, test } from "@playwright/test";

// ADM-06 / ADM-07 / UI-01 — home renders in both locales (backend absent: fallback hero, no sections).
for (const locale of ["en", "ar"] as const) {
  test(`UI-01: home renders without overflow at 360px in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("how-resale")).toBeAttached();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test(`UI-01: how-resale is static under reduced motion in /${locale}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${locale}`);
    const steps = page.locator("[data-step]");
    await expect(steps).toHaveCount(3);
    for (const i of [0, 1, 2]) {
      await expect(steps.nth(i)).toHaveCSS("opacity", "1");
    }
  });
}
