import { expect, test } from "@playwright/test";

// The API is not needed: every request is answered by the test (no real backend in e2e).
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "UNAUTHORIZED" }) }),
  );
});

test("AUTH-06 · opening the dashboard without a session redirects to login (RTL)", async ({ page }) => {
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("تسجيل الدخول");
});

test("AUTH-02 · login shows the localized error and survives dark mode (en)", async ({ page }) => {
  await page.route("**/api/v1/auth/login", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ code: "INVALID_CREDENTIALS", message: "x" }) }),
  );
  await page.goto("/login");
  await page.getByTestId("locale-toggle").click();
  await page.getByTestId("theme-toggle").click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByLabel("Email").fill("a@b.co");
  await page.getByLabel("Password").fill("whatever1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("login-error")).toHaveText("Incorrect email or password.");
});

test("AUTH-02 · accept-invite prefills the email from the query", async ({ page }) => {
  await page.goto("/accept-invite?email=new%40furnixa.test");
  await expect(page.getByLabel("البريد الإلكتروني")).toHaveValue("new@furnixa.test");
});
