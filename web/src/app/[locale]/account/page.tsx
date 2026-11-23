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
