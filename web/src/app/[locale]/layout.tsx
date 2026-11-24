import { DirectionProvider } from "@radix-ui/react-direction";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Providers } from "@/components/providers";
import { cartConfigFrom } from "@/lib/cart/config";
import { activeCityCount } from "@/lib/delivery-cities";
import { SiteFactsProvider } from "@/lib/site-facts";
import { getCategories, getSettings } from "@/lib/api/public";
import { routing } from "@/i18n/routing";
import { pick } from "@/lib/pick";
import { siteUrl } from "@/lib/seo";
import "../globals.css";

// NFR-03: site-wide title/description from admin SEO settings (fallback "Furnixa"), absolute URLs.
export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const settings = await getSettings();
  // The Arabic home title must be Arabic too: the SEO title, else the store name, else the latin brand.
  const brand = pick(settings?.storeName, locale) || "Furnixa";
  const title = pick(settings?.seo?.title, locale) || brand;
  const description = pick(settings?.seo?.description, locale);
  return {
    metadataBase: new URL(siteUrl()),
    // "<page> | <brand>" everywhere, "<brand>" on the home page (QA 2026-11-24 item 10)
    title: { default: title, template: `%s | ${brand}` },
    description: description || undefined,
    openGraph: { siteName: "Furnixa", locale },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  const dir = locale === "ar" ? "rtl" : "ltr";
  // Per-locale font bundles so each locale only preloads its own font files.
  const fonts =
    locale === "ar" ? await import("@/fonts/arabic") : await import("@/fonts/latin");

  const skip = (await getTranslations({ locale, namespace: "nav" }))("skip");
  const [categories, settings] = await Promise.all([getCategories(), getSettings()]);

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${fonts.heading.variable} ${fonts.body.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <DirectionProvider dir={dir}>
            <SiteFactsProvider cityCount={activeCityCount(settings)}>
            <Providers>
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
              >
                {skip}
              </a>
              <SiteHeader
                categories={categories}
                logoUrl={settings?.logo?.url ?? null}
                cartConfig={cartConfigFrom(settings)}
              />
              <div id="main-content" tabIndex={-1} className="outline-none">
                {children}
              </div>
              <SiteFooter settings={settings} />
            </Providers>
            </SiteFactsProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
