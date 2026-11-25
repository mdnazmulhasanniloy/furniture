import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { TrustStrip } from "@/components/home/trust-strip";
import { Hero, HeroFallback } from "@/components/home/hero";
import { HomeSections, type ShelfFallback } from "@/components/home/home-sections";
import type { Locale } from "@/i18n/routing";
import { getHome, getProducts, getSettings } from "@/lib/api/public";
import { sectionHasContent } from "@/lib/home";
import { pick } from "@/lib/pick";
import { alternatesFor } from "@/lib/seo";

/**
 * The home page is the one page whose title is just the store name (QA 2026-11-24 item 10), so it sets
 * it absolutely - the layout's default is reserved for the 404 (QA B7).
 */
export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const settings = await getSettings();
  const brand = pick(settings?.storeName, locale) || "Furnixa";
  const title = pick(settings?.seo?.title, locale) || brand;
  return { title: { absolute: title }, alternates: alternatesFor(locale, "/") };
}

/** Newest products of a type, for a shelf tab the admin has not configured (ADR-015 Q-1). */
async function newestByType(type: "NEW" | "RESALE") {
  const res = await getProducts(`type=${type}&sort=newest&limit=8`);
  return res?.items ?? [];
}

export default async function HomePage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const [{ banners, sections }, settings] = await Promise.all([getHome(), getSettings()]);
  const has = (type: string) => sections.some((s) => s.type === type && sectionHasContent(s));
  const fallback: ShelfFallback = {};
  const [newest, resale] = await Promise.all([
    has("NEW_ARRIVALS") ? [] : newestByType("NEW"),
    has("RESALE_PICKS") ? [] : newestByType("RESALE"),
  ]);
  fallback.new = newest;
  fallback.resale = resale;

  return (
    <main>
      {banners.length > 0 ? <Hero banners={banners} /> : <HeroFallback />}
      <HomeSections sections={sections} locale={locale as Locale} fallback={fallback} />
      <TrustStrip settings={settings} />
    </main>
  );
}
