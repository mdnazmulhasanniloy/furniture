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
