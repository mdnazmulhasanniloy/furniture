import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  test(`UI-02: skip link is first tab stop and targets main content in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.keyboard.press("Tab");
    const skip = page.locator('a[href="#main-content"]');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("main").first()).toBeVisible();
  });

  test(`UI-02: no horizontal overflow at 360px and landmarks present in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    for (const path of ["", "/shop", "/cart", "/login"]) {
      await page.goto(`/${locale}${path}`);
      const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(ok, `${path} overflows`).toBe(true);
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toBeVisible();
    }
  });

  test(`UI-02: mobile nav traps focus and Escape returns it in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}`);
    const trigger = page.getByTestId("mobile-nav-trigger");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test(`UI-01: reduced motion removes the hero/marquee animation in /${locale}`, async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto(`/${locale}`);
    const animated = await page.evaluate(
      () => document.getAnimations().filter((a) => a instanceof CSSAnimation && (a.effect?.getTiming().iterations ?? 1) === Infinity).length,
    );
    expect(animated).toBe(0);
    await ctx.close();
  });
}
