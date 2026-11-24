import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pages.notFound" });
  return { title: t("title") };
}

import { notFound } from "next/navigation";

// Any unmatched path under a locale renders the styled 404 inside the site layout (header, footer, fonts).
export default function CatchAll() {
  notFound();
}
