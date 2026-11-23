import { setRequestLocale } from "next-intl/server";

import { CartPage } from "@/components/cart/cart-page";
import { getSettings } from "@/lib/api/public";
import { cartConfigFrom } from "@/lib/cart/config";

export default async function Cart({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getSettings();
  return <CartPage config={cartConfigFrom(settings)} />;
}
