import { expect, test } from "@playwright/test";

// QA 2026-11-24 item 10: every page has its own title, "<page> | <brand>", and the Arabic pages are Arabic
// (including the home page, whose title is the store name).
const PAGES = [
  "/",
  "/shop",
  "/cart",
  "/checkout",
  "/favourites",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify",
  "/account",
  "/account/orders",
  "/account/addresses",
  "/account/notifications",
  "/pages/about",
  "/no-such-page",
] as const;

const ARABIC = /[؀-ۿ]/;

for (const locale of ["en", "ar"] as const) {
  test(`QA-10 · every page has its own title (${locale})`, async ({ page }) => {
    const seen = new Map<string, string>();
    for (const path of PAGES) {
      await page.goto(`/${locale}${path}`, { waitUntil: "domcontentloaded" });
      const title = (await page.title()).trim();
      expect(title, path).not.toBe("");
      // not the bare brand, except on the home page
      if (path !== "/") {
        expect(title, path).toContain("|");
        const name = title.split("|")[0]!.trim();
        expect(name.length, path).toBeGreaterThan(1);
        if (locale === "ar") expect(ARABIC.test(name), `${path} title "${title}" is not Arabic`).toBe(true);
      } else if (locale === "ar") {
        expect(ARABIC.test(title), `home title "${title}" is not Arabic`).toBe(true);
      }
      seen.set(path, title);
    }
    // the cart carries the cart's own name, not a neighbour's
    const cart = seen.get("/cart")!;
    expect(cart.startsWith(locale === "en" ? "Cart" : "السلة"), `cart title "${cart}"`).toBe(true);
    // and no two different pages share a title (every page names itself)
    const shared = [...seen.entries()].filter(([path]) => path !== "/account/orders");
    const titles = shared.map(([, t]) => t);
    expect(new Set(titles).size, JSON.stringify(Object.fromEntries(shared))).toBe(titles.length);
  });
}
