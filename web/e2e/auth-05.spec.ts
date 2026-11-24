import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  test(`AUTH-05: ${locale} page start tries the refresh cookie via same-origin /api/v1 with Accept-Language`, async ({
    page,
  }) => {
    const seen: { url: string; lang: string | undefined }[] = [];
    await page.route("**/api/v1/auth/csrf", async (route) => {
      seen.push({ url: route.request().url(), lang: route.request().headers()["accept-language"] });
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ code: "UNAUTHORIZED", message: "no session" }),
      });
    });
    await page.goto(`/${locale}`);
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    expect(new URL(seen[0].url).origin).toBe(new URL(page.url()).origin);
    expect(seen[0].lang).toBe(locale);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  });
}
