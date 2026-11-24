import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "favourites" });
  return { title: t("title"), alternates: alternatesFor(locale, "/favourites") };
}

import { setRequestLocale } from "next-intl/server";

import { FavouritesPage } from "@/components/favourites/favourites-page";

export default async function Favourites({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FavouritesPage />;
}
