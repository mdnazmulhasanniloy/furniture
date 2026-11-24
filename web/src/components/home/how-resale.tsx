import { useTranslations } from "next-intl";

const STEPS = ["browse", "grade", "deliver"] as const;

/**
 * "How pre-owned works": the only numbered block on the site, because it is a real three-step sequence.
 * Static (no motion, ADR-015): a sand band, a date-gold hairline over each step.
 */
export function HowResale() {
  const t = useTranslations("home.resale");
  return (
    <section
      data-testid="how-resale"
      aria-labelledby="how-resale-title"
      className="bg-muted py-16 md:py-24"
    >
      <div className="mx-auto w-full max-w-7xl px-4 md:px-8">
        <h2 id="how-resale-title" className="text-3xl font-semibold">
          {t("title")}
        </h2>
        <p className="measure mt-3 text-muted-foreground">{t("subtitle")}</p>
        <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-12">
          {STEPS.map((key, i) => (
            <li key={key} data-step className="border-t border-gold pt-5">
              <span className="font-display text-sm font-medium text-muted-foreground">{t("step", { n: i + 1 })}</span>
              <h3 className="mt-2 text-xl font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="measure mt-2 text-muted-foreground">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
