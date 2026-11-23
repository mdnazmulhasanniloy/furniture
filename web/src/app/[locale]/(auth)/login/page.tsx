import { setRequestLocale } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";

export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string }>;
}>) {
  const { locale } = await params;
  const { reset } = await searchParams;
  setRequestLocale(locale);
  return <LoginForm resetDone={reset === "1"} />;
}
