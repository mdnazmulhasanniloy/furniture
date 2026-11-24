import { expect, test } from "@playwright/test";

/**
 * QA 2026-11-25 (C3). The Arabic dashboard name wrapped onto a second line in the sidebar header.
 * jsdom has no layout, so this is measured in the browser on the production build: the name must
 * occupy exactly one line box and must not be clipped.
 */
const admin = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};

test.beforeEach(async ({ page }) => {
  // Playwright matches the LAST registered route first, so the catch-all goes in first.
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: "NOT_FOUND" }) }),
  );
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "c1" }) }),
  );
  await page.route("**/api/v1/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ accessToken: "at-1", user: admin }),
    }),
  );
});

for (const locale of ["ar", "en"] as const) {
  test(`C3 · the ${locale} dashboard name stays on one line in the sidebar`, async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByTestId("sidebar");
    await expect(sidebar).toBeVisible();
    if (locale === "en") {
      await page.getByTestId("locale-toggle").click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }
    const title = page.getByTestId("sidebar-title");
    await expect(title).toBeVisible();
    const box = await title.evaluate((el) => ({
      lines: el.getClientRects().length,
      height: Math.round(el.getBoundingClientRect().height),
      lineHeight: Math.round(parseFloat(getComputedStyle(el).lineHeight)),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      text: el.textContent,
    }));
    expect(box.text?.length, "the name is rendered").toBeGreaterThan(3);
    expect(box.lines, `${box.text} occupies ${box.lines} line boxes`).toBe(1);
    expect(box.height, `${box.text} is ${box.height}px tall, one line is ${box.lineHeight}px`).toBeLessThanOrEqual(
      Math.round(box.lineHeight * 1.3),
    );
    // and it is not quietly cut off at that size
    expect(box.scrollWidth, `${box.text} is clipped`).toBeLessThanOrEqual(box.clientWidth + 1);
  });
}
