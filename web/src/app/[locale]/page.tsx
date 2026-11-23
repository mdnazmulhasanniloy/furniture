import { getTranslations, setRequestLocale } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";

export default async function HomePage({
  params,
}: Readonly<{ params: Promise<{ locale: string }> }>) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <div className="mx-auto max-w-7xl px-4">
      <header className="flex items-center justify-between py-6">
        <span className="font-display text-2xl font-semibold text-primary">
          {t("home.brand")}
        </span>
        <LanguageSwitcher />
      </header>
      <main className="py-14">
        <h1 className="font-display max-w-3xl text-4xl font-semibold leading-tight">
          {t("home.tagline")}
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">{t("home.intro")}</p>
        <Button className="mt-8" size="lg">
          {t("nav.shop")}
        </Button>
      </main>
    </div>
  );
}
