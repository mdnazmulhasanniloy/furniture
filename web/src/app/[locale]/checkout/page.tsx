import { setRequestLocale } from "next-intl/server";

import { CheckoutPage } from "@/components/checkout/checkout-page";
import { getSettings } from "@/lib/api/public";
import { activeCities } from "@/lib/checkout/cities";

export default async function Checkout({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getSettings();
  const cities = activeCities(settings);
  return <CheckoutPage cities={cities} />;
}
