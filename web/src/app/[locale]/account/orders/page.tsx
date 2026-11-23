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
