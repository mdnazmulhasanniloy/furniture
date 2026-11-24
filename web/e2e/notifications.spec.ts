import { expect, test } from "@playwright/test";

// NOTIF-03 — the header bell target exists: guests opening the notification centre are sent to
// login (no backend needed), in both locales, without horizontal overflow at 360px.
// The admin-status-change -> toast < 2 s flow needs the live backend + socket server; it is
// covered by the mocked-socket component tests (`NOTIF-01 · ...`) and left for the preview check.
for (const locale of ["en", "ar"] as const) {
  test(`NOTIF-03: guest on /${locale}/account/notifications redirects to login`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}/account/notifications`);
    await page.waitForURL(new RegExp(`/${locale}/login$`));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dir)).toBe(locale === "ar" ? "rtl" : "ltr");
  });
}
