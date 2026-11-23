import { setRequestLocale } from "next-intl/server";

import { ForgotForm } from "@/components/auth/forgot-form";

export default async function Page({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ForgotForm />;
}
