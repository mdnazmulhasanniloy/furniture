import { expect, test } from "@playwright/test";

for (const locale of ["en", "ar"] as const) {
  test(`AUTH-01: ${locale} register then OTP screen (mocked API) with 60 s resend countdown`, async ({ page }) => {
    // QA B2: a guest page start calls /auth/refresh, not /auth/csrf.
    await page.route("**/api/v1/auth/refresh", (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "UNAUTHORIZED" }) }),
    );
    let registerBody: Record<string, unknown> | null = null;
    await page.route("**/api/v1/auth/register", async (r) => {
      registerBody = r.request().postDataJSON();
      await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ message: "ok" }) });
    });
    const hydrated = page.waitForRequest("**/api/v1/auth/refresh"); // sent from an effect: page is interactive
    await page.goto(`/${locale}/register`);
    await hydrated;
    await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
    const inputs = page.locator("main form input");
    await inputs.nth(0).fill("Sara");
    await inputs.nth(1).fill("Ali");
    await inputs.nth(2).fill("sara@example.com");
    await inputs.nth(3).fill("Abc12345!");
    await page.locator("main form button[type=submit]").click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/verify$`));
    expect(registerBody).toMatchObject({ email: "sara@example.com", preferredLocale: locale });
    await expect(page.getByTestId("otp-5")).toBeVisible();
    await expect(page.getByTestId("resend-countdown")).toContainText(/6\d|5\d/);
  });

  test(`AUTH-02: ${locale} login page renders and a wrong password shows a localized error`, async ({ page }) => {
    // QA B2: a guest page start calls /auth/refresh, not /auth/csrf.
    await page.route("**/api/v1/auth/refresh", (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "UNAUTHORIZED" }) }),
    );
    await page.route("**/api/v1/auth/login", (r) =>
      r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "English API message" }) }),
    );
    const hydrated = page.waitForRequest("**/api/v1/auth/refresh"); // sent from an effect: page is interactive
    await page.goto(`/${locale}/login`);
    await hydrated;
    const inputs = page.locator("main form input");
    await inputs.nth(0).fill("a@b.co");
    await inputs.nth(1).fill("wrongpass1");
    await page.locator("main form button[type=submit]").click();
    const alert = page.locator("main [role=alert]");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText("English API message");
  });
}
