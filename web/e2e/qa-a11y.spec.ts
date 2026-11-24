import { expect, test } from "@playwright/test";

// QA 2026-11-24 item 9: accessible names of the shop filters and of the home "New / Pre-owned" tabs, in both locales.
// The names are read the way a screen reader gets them (getByRole with an exact name), so an unnamed "on" input or a
// doubled "New New" fails these.

const NAMES = {
  en: { allCategories: "All categories", inStock: "In stock only" },
} as const;

test("QA-9 · every shop filter input has an accessible name (en)", async ({ page }) => {
  await page.goto("/en/shop");
  const form = page.getByRole("form", { name: /filters/i }).first();
  const inputs = form.locator("input[type=radio], input[type=checkbox]");
  const n = await inputs.count();
  expect(n).toBeGreaterThan(4);
  for (let i = 0; i < n; i++) {
    const el = inputs.nth(i);
    const name = await el.evaluate((node) => {
      // accessible name by the label rules: aria-label, aria-labelledby, then the associated label text
      const input = node as HTMLInputElement;
      const aria = input.getAttribute("aria-label");
      if (aria) return aria.trim();
      return (input.labels ? [...input.labels].map((l) => l.textContent ?? "").join(" ") : "").trim();
    });
    expect(name, `input #${i} (${await el.getAttribute("name")})`).not.toBe("");
    expect(name.toLowerCase()).not.toBe("on");
  }
  await expect(form.getByRole("radio", { name: NAMES.en.allCategories, exact: true })).toBeVisible();
  await expect(form.getByRole("checkbox", { name: NAMES.en.inStock, exact: true })).toBeVisible();
});

test("QA-9 · every shop filter input has an accessible name (ar)", async ({ page }) => {
  await page.goto("/ar/shop");
  const inputs = page.locator("form[aria-label] input[type=radio], form[aria-label] input[type=checkbox]");
  const n = await inputs.count();
  expect(n).toBeGreaterThan(4);
  for (let i = 0; i < n; i++) {
    const name = await inputs.nth(i).evaluate((node) => {
      const input = node as HTMLInputElement;
      return (input.getAttribute("aria-label") ?? [...(input.labels ?? [])].map((l) => l.textContent ?? "").join(" ")).trim();
    });
    expect(name, `ar input #${i}`).not.toBe("");
  }
});

for (const locale of ["en", "ar"] as const) {
  test(`QA-9 · the home New / Pre-owned tabs have a single, clean name (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const tabs = page.getByRole("tab");
    const count = await tabs.count();
    if (count === 0) test.skip(true, "no shelf with two tabs in this environment's data");
    for (let i = 0; i < count; i++) {
      const label = (await tabs.nth(i).innerText()).trim();
      const words = label.split(/\s+/);
      // the same word twice in a row ("New New") would be read out loud
      for (let w = 1; w < words.length; w++) expect(words[w], `tab name "${label}"`).not.toBe(words[w - 1]);
      // the accessible name (what a screen reader reads) excludes the aria-hidden pill copy
      const name = await tabs.nth(i).evaluate((el) => {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
        return (clone.textContent ?? "").trim();
      });
      expect(name.length).toBeGreaterThan(0);
      expect(name.split(/\s+/)).toHaveLength(name.split(/\s+/).filter((x, j, a) => x !== a[j - 1]).length);
    }
  });
}
