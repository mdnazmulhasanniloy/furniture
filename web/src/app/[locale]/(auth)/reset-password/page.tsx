import { setRequestLocale } from "next-intl/server";

import { ResetForm } from "@/components/auth/reset-form";

export default async function Page({ params }: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ResetForm />;
}
