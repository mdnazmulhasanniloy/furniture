import { expect, test, type Page } from "@playwright/test";

// CR-011 checkpoint 2 review, item 1: after the hero scrolls away the header is opaque, and every non-home page starts solid.
// The scrolling is done with real mouse-wheel input, as a visitor would.

const opaque = (rgb: string) => {
  const m = rgb.match(/rgba?\(([^)]+)\)/)?.[1]?.split(",").map((x) => parseFloat(x));
  return !!m && (m.length === 3 || m[3] === 1) && m[0] === 255 && m[1] === 255 && m[2] === 255;
};

async function headerState(page: Page) {
  return page.getByTestId("site-header").evaluate((el) => {
    const cs = getComputedStyle(el);
    const logo = el.querySelector("a[href]") as HTMLElement;
    const r = logo.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      bg: cs.backgroundColor,
      borderBottom: cs.borderBottomColor,
      over: el.getAttribute("data-over-hero"),
      logoOnTop: !!hit && el.contains(hit),
      headerBottom: el.getBoundingClientRect().bottom,
    };
  });
}

for (const locale of ["en", "ar"] as const) {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`UI-04: the home header is transparent over the hero and opaque after scrolling past it at ${width}px in /${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`);
      const hero = page.locator("[data-hero]").first();
      await expect(hero).toBeVisible();
      const top = await headerState(page);
      expect(top.over).toBe("true");
      expect(top.bg).toMatch(/rgba\(0, 0, 0, 0\)|transparent/); // floating over the photo
      // scroll with the wheel until the hero is gone, then a little more
      const heroHeight = (await hero.boundingBox())!.height;
      for (let y = 0; y < heroHeight + 300; y += 400) await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(heroHeight);
      await expect.poll(async () => (await headerState(page)).over, { timeout: 5000 }).toBe("false");
      await expect.poll(async () => opaque((await headerState(page)).bg), { timeout: 5000 }).toBe(true); // after the 200 ms fade
      const after = await headerState(page);
      expect(opaque(after.bg), `background ${after.bg}`).toBe(true);
      expect(after.borderBottom).not.toMatch(/rgba\(0, 0, 0, 0\)/); // the hairline is there
      expect(after.logoOnTop).toBe(true);
      // nothing is drawn through the header: the first content under it starts below it or is covered by it
      const overlap = await page.evaluate(() => {
        const h = document.querySelector("[data-testid=site-header]")!.getBoundingClientRect();
        const probe = document.elementFromPoint(window.innerWidth / 2, h.bottom - 2);
        return !!probe && !!document.querySelector("[data-testid=site-header]")!.contains(probe);
      });
      expect(overlap).toBe(true); // the header's own box sits on top of whatever scrolled under it
      // and back to the top: transparent again
      await page.mouse.wheel(0, -20000);
      await expect.poll(async () => (await headerState(page)).over, { timeout: 5000 }).toBe("true");
    });
  }

  test(`UI-04: every non-home page starts with a solid header in /${locale}`, async ({ page }) => {
    for (const path of ["/shop", "/cart", "/favourites", "/login", "/no-such-page"]) {
      await page.goto(`/${locale}${path}`);
      const s = await headerState(page);
      expect(s.over, path).toBe("false");
      expect(opaque(s.bg), `${path} background ${s.bg}`).toBe(true);
    }
  });
}

// CR-011 checkpoint 2 review, round 2: the header must follow the hero's real position on every load, whether the
// page is opened cold or reached by a client-side link, at the viewport sizes the owner uses.
const SIZES = [
  [1905, 744],
  [1440, 900],
  [390, 844],
] as const;

async function wheelPastHero(page: Page) {
  const hero = page.locator("[data-hero]").first();
  await expect(hero).toBeVisible();
  const bottom = await hero.evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
  let y = 0;
  while (y < bottom + 120) {
    await page.mouse.wheel(0, 300);
    y += 300;
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(bottom);
  // the hero is really out of the viewport (the real position, not what the header believes)
  expect(await hero.evaluate((el) => el.getBoundingClientRect().bottom)).toBeLessThan(0);
}

async function expectSolid(page: Page, label: string) {
  await expect.poll(async () => (await headerState(page)).over, { timeout: 5000, message: `${label}: data-over-hero` }).toBe("false");
  await expect.poll(async () => opaque((await headerState(page)).bg), { timeout: 5000, message: `${label}: opaque` }).toBe(true);
}

for (const locale of ["en", "ar"] as const) {
  for (const [width, height] of SIZES) {
    test(`UI-04: header follows the hero on a cold load at ${width}x${height} in /${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`, { waitUntil: "load" });
      await expect.poll(async () => (await headerState(page)).over).toBe("true");
      await wheelPastHero(page);
      await expectSolid(page, "cold");
    });

    test(`UI-04: header follows the hero after a client-side navigation at ${width}x${height} in /${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}/shop`, { waitUntil: "load" });
      await expect.poll(async () => (await headerState(page)).over).toBe("false");
      await page.getByTestId("site-header").locator("a[href]").first().click(); // the logo: a client-side link home
      await expect(page).toHaveURL(new RegExp(`/${locale}/?$`));
      await expect(page.locator("[data-hero]").first()).toBeVisible();
      await expect.poll(async () => (await headerState(page)).over).toBe("true");
      await wheelPastHero(page);
      await expectSolid(page, "after navigation");
    });
  }
}
