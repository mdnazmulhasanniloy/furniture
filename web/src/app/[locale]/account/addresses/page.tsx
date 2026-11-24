import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.addresses" });
  return { title: t("title"), alternates: alternatesFor(locale, "/account/addresses") };
}

import { setRequestLocale } from "next-intl/server";

import { AccountShell } from "@/components/account/account-shell";
import { AddressesPanel } from "@/components/account/addresses-panel";
import { getSettings } from "@/lib/api/public";
import { activeCities } from "@/lib/checkout/cities";

export default async function AccountAddresses({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const settings = await getSettings();
  return (
    <AccountShell tab="addresses">
      <AddressesPanel cities={activeCities(settings)} />
    </AccountShell>
  );
}
