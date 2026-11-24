import { setRequestLocale } from "next-intl/server";

import { FavouritesPage } from "@/components/favourites/favourites-page";

export default async function Favourites({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <FavouritesPage />;
}
