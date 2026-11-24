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

  test(`UI-01: the hero is an arch with a gold outline and two actions in /${locale}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${locale}`);
    const arch = page.getByTestId("arch").first();
    await expect(arch).toBeVisible();
    await expect(page.getByTestId("arch-outline").first()).toBeAttached();
    // 4:5 portrait arch
    const box = (await arch.boundingBox())!;
    expect(Math.abs(box.height / box.width - 1.25)).toBeLessThan(0.02);
    await expect(page.locator("h1.type-hero")).toBeVisible();
    await expect(page.locator('main a[href$="/shop?type=resale"]').first()).toBeVisible();
    // the clip-path is the arch mask, not a rounded rectangle
    const clip = await arch.locator(".arch").evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip).toContain("fx-arch");
  });

  test(`UI-01: the contact strip is gone from home and contact lives in the footer in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("main [data-testid='contact-strip']")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });
}
