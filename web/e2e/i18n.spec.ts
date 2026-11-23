import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const messages = {
  en: JSON.parse(readFileSync(path.resolve(__dirname, "../messages/en.json"), "utf8")),
  ar: JSON.parse(readFileSync(path.resolve(__dirname, "../messages/ar.json"), "utf8")),
};

test.describe("I18N-01 — language routing, dir and RTL", () => {
  test("I18N-01: /ar renders <html lang='ar' dir='rtl'> with Arabic strings", async ({
    page,
  }) => {
    await page.goto("/ar");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "ar");
    await expect(html).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      messages.ar.home.tagline,
    );
  });

  test("I18N-01: /en renders <html lang='en' dir='ltr'> with English strings", async ({
    page,
  }) => {
    await page.goto("/en");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("lang", "en");
    await expect(html).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      messages.en.home.tagline,
    );
  });

  test("I18N-01: shadcn/Radix DropdownMenu aligns to the right in /ar (RTL)", async ({
    page,
  }) => {
    await page.goto("/ar");
    const trigger = page.getByTestId("language-switcher");
    await trigger.click();
    const menu = page.getByTestId("language-menu");
    await expect(menu).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    if (!triggerBox || !menuBox) throw new Error("missing bounding boxes");
    // align="start" in RTL means the menu's END (right) edge lines up with the trigger's.
    expect(
      Math.abs(menuBox.x + menuBox.width - (triggerBox.x + triggerBox.width)),
    ).toBeLessThanOrEqual(2);
  });

  test("I18N-01: the same DropdownMenu aligns to the left in /en (LTR)", async ({
    page,
  }) => {
    await page.goto("/en");
    const trigger = page.getByTestId("language-switcher");
    await trigger.click();
    const menu = page.getByTestId("language-menu");
    await expect(menu).toBeVisible();
    const triggerBox = await trigger.boundingBox();
    const menuBox = await menu.boundingBox();
    if (!triggerBox || !menuBox) throw new Error("missing bounding boxes");
    expect(Math.abs(menuBox.x - triggerBox.x)).toBeLessThanOrEqual(2);
  });
});

test.describe("I18N-01 — default locale redirect", () => {
  test("I18N-01: / redirects to /ar by default", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/ar\/?$/);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });
});

test.describe("I18N-01 — returning visitor keeps chosen locale", () => {
  test("I18N-01: / honours the NEXT_LOCALE=en cookie", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL! }]);
    await page.goto("/");
    await expect(page).toHaveURL(/\/en\/?$/);
  });
});
