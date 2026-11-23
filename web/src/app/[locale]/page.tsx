import { getTranslations, setRequestLocale } from "next-intl/server";

import { Hero } from "@/components/home/hero";
import { HomeSections } from "@/components/home/home-sections";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getHome } from "@/lib/api/public";

export default async function HomePage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const { banners, sections } = await getHome();

  return (
    <main>
      {banners.length > 0 ? (
        <Hero banners={banners} />
      ) : (
        // No active banner (or API unreachable): static intro so the page is never blank.
        <div className="mx-auto max-w-7xl px-4 py-14" data-testid="home-fallback-hero">
          <h1 className="font-display max-w-3xl text-4xl font-semibold leading-tight">
            {t("home.tagline")}
          </h1>
          <p className="mt-4 max-w-xl text-muted-foreground">{t("home.intro")}</p>
          <Button className="mt-8" size="lg" asChild>
            <Link href="/shop">{t("nav.shop")}</Link>
          </Button>
        </div>
      )}
      <HomeSections sections={sections} locale={locale as Locale} />
    </main>
  );
}
