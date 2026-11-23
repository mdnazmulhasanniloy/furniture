import { setRequestLocale } from "next-intl/server";

import { VerifyForm } from "@/components/auth/verify-form";

export default async function Page({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <VerifyForm />;
}
