import { expect, test } from "@playwright/test";

test("I18N-01 · Arabic default is RTL, English is LTR, choice survives reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Furnixa Admin");
});

test("I18N-01 · dark mode toggle changes the background token and persists", async ({ page }) => {
  await page.goto("/");
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await bg();
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(await bg()).not.toBe(light);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
