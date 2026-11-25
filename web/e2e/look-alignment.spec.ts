import { expect, test, type Page } from "@playwright/test";

/**
 * T-085 / T-110: a hotspot is a percentage of the *photo*, so it must sit on the same object at every
 * screen width. Before this, the photo was cropped into a fixed box (4:5 on mobile, 16:9 above) while the
 * dots were percentages of that box, so a dot placed on the lamp at 1440 drifted off it at 390.
 *
 * The look comes from the e2e API stub: a 2:1 photo with a dark circle painted at 20% / 60%, which is where
 * the first hotspot is placed - so "on the circle" is a measurable claim, not an eyeball one.
 */
const WIDTHS = [390, 768, 1440] as const;
const FIRST = { x: 20, y: 60 };

/** Where the first dot sits, as a percentage of the photo's own box. */
async function dotPosition(page: Page) {
  return page.evaluate(() => {
    const photo = document.querySelector('[data-testid="look-photo"]') as HTMLElement;
    const dot = document.querySelector('[data-testid="hotspot"]') as HTMLElement;
    const p = photo.getBoundingClientRect();
    const d = dot.getBoundingClientRect();
    const img = photo.querySelector("img") as HTMLImageElement;
    const i = img.getBoundingClientRect();
    return {
      x: ((d.left + d.width / 2 - p.left) / p.width) * 100,
      y: ((d.top + d.height / 2 - p.top) / p.height) * 100,
      photoRatio: p.width / p.height,
      // The photo fills its box exactly: nothing is cropped away, so percentages mean what they say.
      imageCoversBox: Math.abs(i.width - p.width) < 1 && Math.abs(i.height - p.height) < 1,
      naturalRatio: img.naturalWidth / img.naturalHeight,
    };
  });
}

for (const locale of ["en", "ar"] as const) {
  test(`T-085 · the hotspot sits on the same spot of the photo at 390, 768 and 1440 in /${locale}`, async ({
    page,
  }) => {
    const seen: { width: number; x: number; y: number }[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}`);
      const section = page.getByTestId("home-section-SHOP_THE_LOOK");
      await section.scrollIntoViewIfNeeded();
      await expect(page.getByTestId("look-photo")).toBeVisible();

      const m = await dotPosition(page);
      expect(m.imageCoversBox, `photo fills its box at ${width}`).toBe(true);
      // The box takes the photo's own ratio (2:1 here), at every width.
      expect(Math.abs(m.photoRatio - m.naturalRatio), `uncropped at ${width}`).toBeLessThan(0.02);
      expect(Math.abs(m.x - FIRST.x), `x at ${width}`).toBeLessThan(0.6);
      expect(Math.abs(m.y - FIRST.y), `y at ${width}`).toBeLessThan(0.6);
      seen.push({ width, x: m.x, y: m.y });
    }
    // Same place at every width, not merely close to the stored value.
    const xs = seen.map((s) => s.x);
    const ys = seen.map((s) => s.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.6);
  });
}

test("T-085 · Arabic does not mirror the hotspot: a photo is a photograph, not a layout", async ({ page }) => {
  const at = async (locale: "en" | "ar") => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${locale}`);
    await page.getByTestId("home-section-SHOP_THE_LOOK").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("look-photo")).toBeVisible();
    return dotPosition(page);
  };
  const en = await at("en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const ar = await at("ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  expect(Math.abs(ar.x - en.x)).toBeLessThan(0.6); // 20%, not 80%
  expect(Math.abs(ar.y - en.y)).toBeLessThan(0.6);
  expect(Math.abs(ar.x - FIRST.x)).toBeLessThan(0.6);
});
