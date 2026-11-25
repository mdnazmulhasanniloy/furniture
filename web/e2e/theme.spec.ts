import { expect, test, type Page } from "@playwright/test";
import { WALNUT } from "./support/api-stub.mjs";

/**
 * UI-03 (CR-010, ADR-017): the theme an admin applies must reach the storefront as real colour, on the
 * server, with no flash of the default. The e2e API stub applies the walnut preset for the whole run
 * (see support/api-stub.mjs), so "the site is walnut" is measurable rather than a matter of trust.
 */
const T = WALNUT.tokens;
const PRIMARY_RGB = "rgb(107, 63, 42)"; // #6b3f2a
const PAPER_RGB = "rgb(255, 255, 255)"; // fixed in every preset

/** The production CSS is minified, so `#ffffff` comes back as `#fff`. */
const hex = (v: string) =>
  /^#[0-9a-f]{3}$/i.test(v)
    ? `#${v
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")}`
    : v;

const resolved = (page: Page) =>
  page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const footer = document.querySelector("footer") as HTMLElement;
    return {
      primary: cs.getPropertyValue("--primary").trim(),
      muted: cs.getPropertyValue("--muted").trim(),
      price: cs.getPropertyValue("--price").trim(),
      champagne: cs.getPropertyValue("--champagne").trim(),
      // Fixed in every theme: an order or stock state must read the same everywhere.
      background: cs.getPropertyValue("--background").trim(),
      foreground: cs.getPropertyValue("--foreground").trim(),
      destructive: cs.getPropertyValue("--destructive").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      footerBg: getComputedStyle(footer).backgroundColor,
    };
  });

for (const locale of ["en", "ar"] as const) {
  test(`UI-03 · the applied theme colours the storefront in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const m = await resolved(page);

    expect(m.primary).toBe(T.primary);
    expect(m.muted).toBe(T.muted);
    expect(m.price).toBe(T.price);
    expect(m.champagne).toBe(T.champagne);
    // The variables are not decoration: a real element painted with bg-primary is walnut.
    expect(m.footerBg).toBe(PRIMARY_RGB);

    // Paper, ink and the status colours belong to the stylesheet, not to the theme.
    expect(hex(m.background)).toBe("#ffffff");
    expect(hex(m.foreground)).toBe("#14201d");
    expect(hex(m.destructive)).toBe("#b42318");
    expect(m.bodyBg).toBe(PAPER_RGB);
  });
}

test("UI-03 · the theme is in the HTML the server sends, so there is no flash of the default", async ({
  request,
  baseURL,
}) => {
  // No browser, no JavaScript: whatever is here is what the first byte carries.
  const html = await (await request.get(`${baseURL}/en`)).text();
  const htmlTag = html.match(/<html[^>]*>/)?.[0] ?? "";
  expect(htmlTag).toContain("--primary:#6b3f2a");
  expect(htmlTag).toContain("--gold-strong:#8f5f2a");
  expect(htmlTag).not.toContain("#0f4c45"); // the default is nowhere in the markup
  // A theme is not a layout: Arabic gets the same colours, only the direction flips.
  const ar = (await (await request.get(`${baseURL}/ar`)).text()).match(/<html[^>]*>/)?.[0] ?? "";
  expect(ar).toContain('dir="rtl"');
  expect(ar).toContain("--primary:#6b3f2a");
});
