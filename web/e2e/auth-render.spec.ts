import { expect, test } from "@playwright/test";

// CR-011 fix 1: every auth route renders visible, hydrated content in /en and /ar (a blank page was reported).
const ROUTES = ["login", "register", "forgot-password", "reset-password", "verify"] as const;

for (const locale of ["en", "ar"] as const) {
  for (const route of ROUTES) {
    test(`UI-04: /${locale}/${route} renders visible content and hydrates`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/${locale}/${route}`);
      // verify without a pending sign-up sends the visitor to register: still a visible form page
      const main = page.getByTestId("auth-shell");
      await expect(main).toBeVisible();
      const box = (await main.boundingBox())!;
      expect(box.width).toBeGreaterThan(300);
      expect(box.height).toBeGreaterThan(300);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const form = main.locator("form");
      await expect(form).toBeVisible();
      expect((await page.locator("body").innerText()).trim().length).toBeGreaterThan(100);
      // hydrated: a client-only interaction works (the form's first control accepts input)
      const first = form.locator("input:not([type=hidden])").first();
      await first.fill("1");
      await expect(first).toHaveValue("1");
      expect(errors).toEqual([]);
    });
  }
}
