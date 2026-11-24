import Image from "next/image";
import { useTranslations } from "next-intl";

import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { CategoryRow } from "@/components/home/category-row";
import { CtaLink } from "@/components/home/cta-link";
import { HowResale } from "@/components/home/how-resale";
import { Shelf } from "@/components/home/shelf";
import { buttonVariants } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct, HomeSection } from "@/lib/api/public";
import { sectionHasContent } from "@/lib/home";
import { pick } from "@/lib/pick";
import { cn } from "@/lib/utils";

/** Newest products by type, used when the admin has no NEW_ARRIVALS / RESALE_PICKS section (Q-1). */
export type ShelfFallback = { new?: HomeProduct[]; resale?: HomeProduct[] };

function SectionShell({
  section,
  locale,
  children,
}: {
  section: HomeSection;
  locale: Locale;
  children: React.ReactNode;
}) {
  const title = pick(section.title, locale);
  const subtitle = pick(section.subtitle, locale);
  return (
    <section
      data-testid={`home-section-${section.type}`}
      aria-labelledby={`home-${section.id}`}
      className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-20"
    >
      <h2 id={`home-${section.id}`} className="text-3xl font-semibold">
        {title}
      </h2>
      {subtitle ? <p className="measure mt-2 text-muted-foreground">{subtitle}</p> : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

/** Optional admin sections (FEATURED_PRODUCTS, PROMO_BANNER, TESTIMONIALS): below the shelf, same quiet style. */
function OptionalSection({ section, locale }: { section: HomeSection; locale: Locale }) {
  const t = useTranslations();
  switch (section.type) {
    case "FEATURED_PRODUCTS":
      return (
        <SectionShell section={section} locale={locale}>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6">
            {section.products!.map((p) => (
              <ConnectedProductCard key={p.id} product={{ ...p, isFeatured: true }} locale={locale} />
            ))}
          </ul>
        </SectionShell>
      );
    case "PROMO_BANNER": {
      const b = section.banner!;
      const title = pick(b.title, locale);
      const subtitle = pick(b.subtitle, locale);
      return (
        <section
          data-testid="home-section-PROMO_BANNER"
          aria-label={title}
          className="mx-auto max-w-7xl px-4 py-12 md:px-8 md:py-20"
        >
          <div className="grid items-center gap-8 bg-muted md:grid-cols-2">
            <div className="p-8 md:p-12">
              <h2 className="text-3xl font-semibold">{title}</h2>
              {subtitle ? <p className="measure mt-3 text-muted-foreground">{subtitle}</p> : null}
              <CtaLink href={b.ctaHref} className={cn(buttonVariants(), "mt-6 h-12 px-8")}>
                {pick(b.ctaLabel, locale) || t("home.hero.shopNew")}
              </CtaLink>
            </div>
            <div className="relative aspect-[16/10]">
              <Image
                src={b.imageDesktop.url}
                alt={pick(b.imageDesktop.alt, locale)}
                fill
                sizes="(min-width: 768px) 40rem, 100vw"
                className="object-cover"
              />
            </div>
          </div>
        </section>
      );
    }
    case "TESTIMONIALS": {
      // Quiet, static quotes (ADR-015): large text, no cards, no marquee.
      const items = section.config!.testimonials!;
      return (
        <SectionShell section={section} locale={locale}>
          <ul className="grid gap-10 md:grid-cols-3" data-testid="testimonials">
            {items.map((item, i) => (
              <li key={i}>
                <blockquote className="measure text-lg leading-relaxed">{pick(item.quote, locale)}</blockquote>
                <p className="mt-3 text-sm text-muted-foreground">{item.name}</p>
              </li>
            ))}
          </ul>
        </SectionShell>
      );
    }
    default:
      return null;
  }
}

/**
 * Home composition (ADR-015): category bento, ONE shelf (New / Pre-owned), any optional admin sections
 * in the same quiet style, then "How pre-owned works". Empty sections are skipped.
 */
export function HomeSections({
  sections,
  locale,
  fallback,
}: {
  sections: HomeSection[];
  locale: Locale;
  fallback?: ShelfFallback;
}) {
  const visible = sections.filter(sectionHasContent);
  const category = visible.find((s) => s.type === "CATEGORY_GRID");
  const fromSections = (type: HomeSection["type"]) =>
    visible.filter((s) => s.type === type).flatMap((s) => s.products ?? []);
  // The switch is by product type, so the admin's NEW_ARRIVALS / RESALE_PICKS products are pooled and split
  // by type (a "new arrivals" section can hold recently added pre-owned pieces too).
  const pool = [...fromSections("NEW_ARRIVALS"), ...fromSections("RESALE_PICKS")].filter(
    (p, i, all) => all.findIndex((q) => q.id === p.id) === i,
  );
  const newItems = pool.filter((p) => p.type === "NEW");
  const resaleItems = pool.filter((p) => p.type === "RESALE");
  const featuredIds = fromSections("FEATURED_PRODUCTS").map((p) => p.id);
  const optional = visible.filter((s) => ["FEATURED_PRODUCTS", "PROMO_BANNER", "TESTIMONIALS"].includes(s.type));
  return (
    <>
      {category ? <CategoryRow section={category} locale={locale} /> : null}
      <Shelf
        newItems={newItems.length > 0 ? newItems : (fallback?.new ?? [])}
        resaleItems={resaleItems.length > 0 ? resaleItems : (fallback?.resale ?? [])}
        featuredIds={featuredIds}
        locale={locale}
      />
      {optional.map((s) => (
        <OptionalSection key={s.id} section={s} locale={locale} />
      ))}
      <HowResale />
    </>
  );
}
