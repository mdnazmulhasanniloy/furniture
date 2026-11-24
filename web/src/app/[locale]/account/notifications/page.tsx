import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "notifications" });
  return { title: t("title"), alternates: alternatesFor(locale, "/account/notifications") };
}

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
