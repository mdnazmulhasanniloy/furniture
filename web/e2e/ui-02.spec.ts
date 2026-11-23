import { expect, test } from "@playwright/test";

// UI-02 / I18N-01 — layout shell renders and mirrors in RTL (backend may be absent: empty shell).
for (const locale of ["en", "ar"] as const) {
  test(`UI-02: header and footer render in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(page.getByTestId("cart-link")).toBeVisible();
  });

  test(`UI-02: mobile nav sheet opens at 360px in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}`);
    await page.getByTestId("mobile-nav-trigger").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const noOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(noOverflow).toBe(true);
  });
}

test("I18N-01: header mirrors in RTL (logo on the right, cart on the left)", async ({ page }) => {
  await page.goto("/ar");
  const logo = await page.getByRole("banner").getByRole("link").first().boundingBox();
  const cart = await page.getByTestId("cart-link").boundingBox();
  expect(logo!.x).toBeGreaterThan(cart!.x);
  await page.goto("/en");
  const logoEn = await page.getByRole("banner").getByRole("link").first().boundingBox();
  const cartEn = await page.getByTestId("cart-link").boundingBox();
  expect(logoEn!.x).toBeLessThan(cartEn!.x);
});
