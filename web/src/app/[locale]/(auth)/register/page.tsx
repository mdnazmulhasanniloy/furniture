import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { alternatesFor } from "@/lib/seo";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  return { title: t("registerTitle"), alternates: alternatesFor(locale, "/register") };
}

import { setRequestLocale } from "next-intl/server";

import { RegisterForm } from "@/components/auth/register-form";

export default async function Page({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}>) {
  const { locale } = await params;
  const { next } = await searchParams;
  setRequestLocale(locale);
  // `next` is sanitised in the form (same-origin paths only, QA B2).
  return <RegisterForm next={next} />;
}
