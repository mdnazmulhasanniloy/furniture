import { expect, test } from "@playwright/test";

// FAV-01 — the favourites page works for a guest in both locales (backend absent: empty state),
// mirrors in RTL and does not overflow at 360 px.
for (const locale of ["en", "ar"] as const) {
  test(`FAV-01: guest favourites page shows the empty state in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}/favourites`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("favourites-empty")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test(`FAV-01: the header heart links to the favourites page in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await page.getByTestId("favourites-link").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/favourites$`));
  });

  test(`FAV-01: a guest list in localStorage is counted in the header in /${locale}`, async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "fx_guest_favourites",
        JSON.stringify([{ productId: "a1", slug: "a" }, { productId: "b2", slug: "b" }]),
      );
    });
    await page.goto(`/${locale}`);
    await expect(page.getByTestId("favourites-count")).toHaveText("2");
  });
}
