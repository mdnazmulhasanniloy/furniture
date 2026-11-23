import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { AccountShell } from "@/components/account/account-shell";
import { OrderDetail } from "@/components/account/order-detail";

export default async function AccountOrder({
  params,
}: Readonly<{ params: Promise<{ locale: string; id: string }> }>) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  return (
    <AccountShell tab="orders">
      <OrderDetail orderId={id} />
    </AccountShell>
  );
}
