import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "checkout.success" });
  return { title: t("title") };
}

import { setRequestLocale } from "next-intl/server";

import { SuccessPage } from "@/components/checkout/success-page";

export default async function Success({
  params,
  searchParams,
}: Readonly<{ params: Promise<{ locale: string }>; searchParams: Promise<{ id?: string }> }>) {
  const { locale } = await params;
  const { id } = await searchParams;
  setRequestLocale(locale);
  return <SuccessPage orderId={typeof id === "string" && /^[a-f0-9]{24}$/i.test(id) ? id : null} />;
}
