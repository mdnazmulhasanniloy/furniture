import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { Hero, HeroFallback } from "@/components/home/hero";
import { HomeSections, type ShelfFallback } from "@/components/home/home-sections";
import type { Locale } from "@/i18n/routing";
import { getHome, getProducts } from "@/lib/api/public";
import { sectionHasContent } from "@/lib/home";
import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: alternatesFor(locale, "/") };
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
  const { banners, sections } = await getHome();
  const has = (type: string) => sections.some((s) => s.type === type && sectionHasContent(s));
  const fallback: ShelfFallback = {};
  const [newest, resale] = await Promise.all([
    has("NEW_ARRIVALS") ? [] : newestByType("NEW"),
    has("RESALE_PICKS") ? [] : newestByType("RESALE"),
  ]);
  fallback.new = newest;
  fallback.resale = resale;

  return (
    <main className="band-end">
      {banners.length > 0 ? <Hero banners={banners} /> : <HeroFallback />}
      <HomeSections sections={sections} locale={locale as Locale} fallback={fallback} />
    </main>
  );
}
