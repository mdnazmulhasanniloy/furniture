import Image from "next/image";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import type { ProductDetail } from "@/lib/api/public";
import { CONDITIONS } from "@/lib/shop";
import { pick } from "@/lib/pick";
import { cn } from "@/lib/utils";

/**
 * Condition report (pre-owned only, ADR-015 Q-2). Real data only: the grade, the seller-written notes
 * (`conditionNotes`), the product's extra photos as close-ups, and the byline "Photos and condition notes by
 * Furnixa". The report never states that an item was inspected; if every item is, the owner changes the one
 * string `product.condition.byline` per language.
 */
export async function ConditionReport({ product, locale }: { product: ProductDetail; locale: Locale }) {
  const t = await getTranslations({ locale });
  const notes = pick(product.conditionNotes, locale);
  const closeups = (product.images ?? []).slice(1, 7);
  const title = pick(product.title, locale);
  return (
    <section
      aria-labelledby="cond-h"
      data-testid="condition-report"
      className="bg-muted px-5 py-8 md:px-10 md:py-12"
    >
      <h2 id="cond-h" className="text-2xl font-semibold">
        {t("product.condition.title")}
      </h2>

      <ol
        aria-label={t("product.condition.scale")}
        data-testid="grade-scale"
        className="mt-6 grid grid-cols-4 rounded-md border-[1.5px] border-foreground p-0.5 text-center text-sm font-medium"
      >
        {CONDITIONS.map((c) => {
          const on = c === product.condition;
          return (
            <li
              key={c}
              aria-current={on ? "true" : undefined}
              data-grade={c}
              className={cn(
                "rounded-[4px] px-1 py-2.5",
                on ? "bg-foreground text-background" : "text-foreground",
              )}
            >
              {t(`condition.${c}`)}
            </li>
          );
        })}
      </ol>
      <p data-testid="condition-grade" className="measure mt-4 text-lg">
        <span className="font-semibold">
          {t("product.condition.grade")}: {t(`condition.${product.condition}`)}.
        </span>{" "}
        {t(`product.condition.grades.${product.condition}`)}
      </p>

      {notes ? (
        <div className="mt-8">
          <h3 className="text-lg font-semibold">{t("product.condition.notes")}</h3>
          <p data-testid="condition-notes" className="measure mt-2 whitespace-pre-line">
            {notes}
          </p>
        </div>
      ) : null}

      {closeups.length > 0 ? (
        <div className="mt-8">
          <h3 className="text-lg font-semibold">{t("product.condition.closeups")}</h3>
          <ul data-testid="closeups" className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {closeups.map((img, i) => (
              <li key={`${img.url}-${i}`} className="relative aspect-square overflow-hidden bg-background">
                <Image
                  src={img.url}
                  alt={pick(img.alt, locale) || title}
                  fill
                  sizes="(min-width: 1024px) 12rem, 30vw"
                  className="object-cover"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p data-testid="condition-byline" className="mt-8 text-sm text-muted-foreground">
        {t("product.condition.byline")}
      </p>
    </section>
  );
}
