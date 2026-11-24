import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.orders" });
  return { title: t("title"), alternates: alternatesFor(locale, "/account/orders") };
}

import { setRequestLocale } from "next-intl/server";

import { AccountShell } from "@/components/account/account-shell";
import { OrdersList } from "@/components/account/orders-list";

export default async function AccountOrders({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AccountShell tab="orders">
      <OrdersList />
    </AccountShell>
  );
}
