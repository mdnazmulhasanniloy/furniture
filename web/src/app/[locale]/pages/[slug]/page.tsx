import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { StaticPageView } from "@/components/pages/static-page";
import { getPage } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { alternatesFor } from "@/lib/seo";

type Props = Readonly<{ params: Promise<{ locale: string; slug: string }> }>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const result = await getPage(slug);
  if (result.status !== "ok") return { title: "Furnixa" };
  const { page } = result;
  const title = pick(page.metaTitle, locale) || pick(page.title, locale);
  const description = pick(page.metaDescription, locale);
  return {
    title: `${title} | Furnixa`,
    description: description || undefined,
    alternates: alternatesFor(locale, `/pages/${slug}`),
    openGraph: { title, description: description || undefined, locale },
  };
}

export default async function StaticPageRoute({ params }: Props) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const result = await getPage(slug);
  if (result.status === "not-found") notFound();
  if (result.status === "error") {
    const t = await getTranslations("pages");
    return (
      <main className="band mx-auto w-full max-w-3xl px-5 sm:px-8">
        <p role="alert" className="rounded-lg bg-blush p-6 text-center text-base text-blush-foreground" data-testid="static-page-error">
          {t("loadError")}
        </p>
      </main>
    );
  }
  return <StaticPageView page={result.page} locale={locale} />;
}
