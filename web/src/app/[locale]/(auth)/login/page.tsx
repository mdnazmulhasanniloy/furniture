import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "nav" });
  return { title: t("login"), alternates: alternatesFor(locale, "/login") };
}

import { setRequestLocale } from "next-intl/server";

import { LoginForm } from "@/components/auth/login-form";

export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reset?: string; next?: string }>;
}>) {
  const { locale } = await params;
  const { reset, next } = await searchParams;
  setRequestLocale(locale);
  // `next` is sanitised in the form (same-origin paths only, QA B2).
  return <LoginForm resetDone={reset === "1"} next={next} />;
}
