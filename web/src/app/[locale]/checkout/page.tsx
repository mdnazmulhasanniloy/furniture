import { setRequestLocale } from "next-intl/server";

import { CheckoutPage } from "@/components/checkout/checkout-page";
import { getSettings } from "@/lib/api/public";

export default async function Checkout({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getSettings();
  // Active cities only, in the admin's order (ADR-008); the API re-checks on every write.
  const cities = (settings?.deliveryCities ?? [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ code: c.code, name: c.name ?? { en: c.code } }));
  return <CheckoutPage cities={cities} />;
}
