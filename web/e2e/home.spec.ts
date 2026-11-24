import { expect, test } from "@playwright/test";

// ADM-06 / ADM-07 / UI-01 — home renders in both locales (backend absent: fallback hero, no sections).
for (const locale of ["en", "ar"] as const) {
  test(`UI-01: home renders without overflow at 360px in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`/${locale}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("how-resale")).toBeAttached();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test(`UI-01: how-resale is static under reduced motion in /${locale}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${locale}`);
    const steps = page.locator("[data-step]");
    await expect(steps).toHaveCount(3);
    for (const i of [0, 1, 2]) {
      await expect(steps.nth(i)).toHaveCSS("opacity", "1");
    }
  });

  test(`UI-04: the hero is a full-bleed carousel with a pause button and no arch in /${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    const hero = page.getByRole("region").filter({ has: page.locator("h1") }).first();
    await expect(hero).toHaveAttribute("aria-roledescription", "carousel");
    const box = (await hero.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(1425); // full bleed (minus a classic scrollbar)
    expect(Math.abs(box.height - 900 * 0.85)).toBeLessThan(2);
    await expect(page.locator("h1.type-hero")).toBeVisible();
    await expect(page.getByTestId("arch")).toHaveCount(0);
    await expect(hero.getByRole("button", { name: /Pause slideshow|إيقاف العرض مؤقتًا/ })).toBeVisible();
    await expect(hero.getByRole("button", { name: /Next slide|الشريحة التالية/ })).toBeVisible();
  });

  test(`UI-04: the first slide image is visible on load at 1440 and 390 in /${locale}`, async ({ page }) => {
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(`/${locale}`);
      const img = page.locator("section[aria-roledescription=carousel] [data-active=true] img").first();
      await expect(img).toBeVisible();
      await expect.poll(async () => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 100), { timeout: 8000 }).toBe(true);
      const box = (await img.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(width - 20);
      expect(box.height).toBeGreaterThan(400);
      await expect(img).toHaveCSS("opacity", "1");
      expect(await img.evaluate((el: HTMLImageElement) => el.loading)).toBe("eager");
      await expect(img).toHaveAttribute("fetchpriority", "high");
    }
  });

  test(`UI-04: reduced motion means no autoplay and no pause button in /${locale}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/${locale}`);
    await expect(page.locator("h1.type-hero")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pause slideshow|إيقاف العرض مؤقتًا/ })).toHaveCount(0);
    const zoom = await page.evaluate(() => document.getAnimations().length);
    expect(zoom).toBe(0);
  });

  test(`UI-01: the contact strip is gone from home and contact lives in the footer in /${locale}`, async ({ page }) => {
    await page.goto(`/${locale}`);
    await expect(page.locator("main [data-testid='contact-strip']")).toHaveCount(0);
    await expect(page.getByRole("contentinfo")).toBeVisible();
  });
}

// CR-011 review item 4: no large empty band between home sections.
for (const width of [390, 1440]) {
  test(`UI-04: the gap between consecutive home sections is at most 80px at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/en");
    const tops = await page.evaluate(() => {
      const main = document.querySelector("main")!;
      // visual gap: the section box ends where its content ends (a plain band has no bottom padding), and the next
      // section's content starts after its top padding (a filled band is counted by its own box)
      const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY + (el.classList.contains("band-fill") ? 0 : parseFloat(getComputedStyle(el).paddingTop));
      const bottom = (el: Element) => el.getBoundingClientRect().bottom + window.scrollY;
      return [...main.children].filter((el) => el.tagName === "SECTION" && el.getAttribute("data-testid") !== "home-hero" && !el.hasAttribute("aria-roledescription")).map((el) => ({ top: top(el), bottom: bottom(el), id: el.getAttribute("data-testid") }));
    });
    expect(tops.length).toBeGreaterThan(0);
    for (let i = 1; i < tops.length; i++) {
      const gap = tops[i]!.top - tops[i - 1]!.bottom;
      expect(gap, `${tops[i - 1]!.id} -> ${tops[i]!.id}`).toBeLessThanOrEqual(80);
      expect(gap).toBeGreaterThanOrEqual(0);
    }
  });
}
