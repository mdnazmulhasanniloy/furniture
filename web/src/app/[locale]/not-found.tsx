import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** 404 (UI-04): inside the site layout, a calm blush panel with two ways out. Copy: pages.notFound.* (new, pending approval). */
export default async function NotFound() {
  const t = await getTranslations("pages.notFound");
  const nav = await getTranslations("nav");
  return (
    <main className="container-wide band" data-testid="not-found">
      <div className="flex min-h-[50vh] flex-col items-start justify-center gap-6 rounded-lg bg-blush p-8 text-blush-foreground md:p-16">
        <h1 className="text-4xl md:text-6xl">{t("title")}</h1>
        <p className="max-w-xl text-lg">{t("body")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/" className={cn(buttonVariants(), "h-12 px-8 text-base")}>
            {t("home")}
          </Link>
          <Link href="/shop" className={cn(buttonVariants({ variant: "outline" }), "h-12 px-8 text-base")}>
            {nav("shop")}
          </Link>
        </div>
      </div>
    </main>
  );
}
