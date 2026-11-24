import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("cart"), alternates: alternatesFor(locale, "/cart") };
}

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
