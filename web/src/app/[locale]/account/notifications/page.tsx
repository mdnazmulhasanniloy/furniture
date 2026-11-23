import { setRequestLocale } from "next-intl/server";

import { AccountShell } from "@/components/account/account-shell";
import { NotificationsPanel } from "@/components/notifications/notifications-panel";

export default async function AccountNotifications({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AccountShell tab="notifications">
      <NotificationsPanel />
    </AccountShell>
  );
}
