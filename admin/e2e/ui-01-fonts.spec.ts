import { expect, test } from "@playwright/test";

// UI-01 / ADR-015 Q-3: the admin uses Readex Pro headings and IBM Plex body, self-hosted (no font CDN).

test("UI-01 · Arabic: Readex Pro heading, IBM Plex Sans Arabic body, fonts really load", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost")) external.push(r.url());
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  const h1 = await page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontFamily);
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(h1).toContain("Readex Pro Variable");
  expect(body.startsWith('"IBM Plex Sans Arabic"')).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  expect(loaded.join(",")).toContain("Readex Pro Variable");
  expect(loaded.join(",")).toContain("IBM Plex Sans Arabic");
  expect(external).toEqual([]); // self-hosted: no request leaves the origin
});

test("UI-01 · English: Readex Pro heading, IBM Plex Sans body, heading tracking tight, Arabic untracked", async ({ page }) => {
  await page.goto("/");
  const tracking = () => page.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).letterSpacing);
  expect(await tracking()).not.toMatch(/^-/); // Arabic (default): never negative
  await page.getByTestId("locale-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  const body = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(body.startsWith('"IBM Plex Sans Variable"')).toBe(true);
  expect(await tracking()).toMatch(/^-/); // -0.02em
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family));
  expect(loaded.join(",")).toContain("IBM Plex Sans Variable");
});
