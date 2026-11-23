import { DirectionProvider } from "@radix-ui/react-direction";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata: Metadata = {
  title: "Furnixa",
};

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

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${fonts.heading.variable} ${fonts.body.variable}`}
    >
      <body>
        <NextIntlClientProvider>
          <DirectionProvider dir={dir}>{children}</DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
