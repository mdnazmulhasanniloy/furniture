import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("title"), alternates: alternatesFor(locale, "/account") };
}

import { setRequestLocale } from "next-intl/server";

import { AccountShell } from "@/components/account/account-shell";
import { ProfileForm } from "@/components/account/profile-form";

export default async function AccountProfile({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <AccountShell tab="profile">
      <ProfileForm />
    </AccountShell>
  );
}
