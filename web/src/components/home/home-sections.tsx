import { useTranslations } from "next-intl";
import Image from "next/image";

import { CtaLink } from "@/components/home/cta-link";
import { ImagePlaceholder } from "@/components/brand";
import { HowResale } from "@/components/home/how-resale";
import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeSection } from "@/lib/api/public";
import { sectionHasContent } from "@/lib/home";
import { pick } from "@/lib/pick";

function SectionShell({
  section,
  locale,
  viewAllHref,
  viewAllLabel,
  children,
}: {
  section: HomeSection;
  locale: Locale;
  viewAllHref?: string;
  viewAllLabel?: string;
  children: React.ReactNode;
}) {
  const title = pick(section.title, locale);
  const subtitle = pick(section.subtitle, locale);
  return (
    <section
      data-testid={`home-section-${section.type}`}
      aria-labelledby={`home-${section.id}`}
      className="mx-auto max-w-7xl px-4 py-12"
    >
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2
            id={`home-${section.id}`}
            className="font-display text-2xl font-semibold md:text-3xl"
          >
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {viewAllHref && viewAllLabel ? (
          <Link
            href={viewAllHref}
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            {viewAllLabel}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SectionBody({ section, locale }: { section: HomeSection; locale: Locale }) {
  const t = useTranslations();
  switch (section.type) {
    case "FEATURED_PRODUCTS":
    case "NEW_ARRIVALS":
    case "RESALE_PICKS": {
      const href =
        section.type === "NEW_ARRIVALS"
          ? "/shop?type=new"
          : section.type === "RESALE_PICKS"
            ? "/shop?type=resale"
            : "/shop";
      return (
        <SectionShell
          section={section}
          locale={locale}
          viewAllHref={href}
          viewAllLabel={t("home.viewAll")}
        >
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {section.products!.map((p) => (
              <ConnectedProductCard key={p.id} product={p} locale={locale} />
            ))}
          </ul>
        </SectionShell>
      );
    }
    case "CATEGORY_GRID":
      return (
        <SectionShell section={section} locale={locale}>
          <ul className="grid auto-rows-[10rem] grid-cols-2 gap-4 md:grid-cols-4">
            {section.categories!.map((c, i) => (
              <li key={c.id} className={i === 0 ? "col-span-2 row-span-2" : undefined}>
                <Link
                  href={`/shop?category=${encodeURIComponent(c.slug)}`}
                  className="group relative block h-full overflow-hidden rounded-lg border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {c.image?.url ? (
                    <Image
                      src={c.image.url}
                      alt=""
                      fill
                      sizes="(min-width: 768px) 25vw, 50vw"
                      className="object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    />
                  ) : (
                    <ImagePlaceholder name={t("home.brand")} />
                  )}
                  <span className="absolute inset-x-0 bottom-0 border-t-2 border-gold bg-primary/90 p-3 text-sm font-medium text-primary-foreground">
                    {pick(c.name, locale)}
                  </span>
                </Link>
              </li>
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
          className="mx-auto max-w-7xl px-4 py-12"
        >
          <div className="relative isolate overflow-hidden rounded-xl bg-muted">
            <Image
              src={b.imageDesktop.url}
              alt=""
              fill
              sizes="(min-width: 1280px) 1280px, 100vw"
              className="-z-10 object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-foreground/45" aria-hidden />
            <div className="flex flex-col items-start gap-3 p-8 text-primary-foreground md:p-12">
              <h2 className="font-display text-2xl font-semibold md:text-3xl">{title}</h2>
              {subtitle ? <p className="max-w-xl">{subtitle}</p> : null}
              <CtaLink
                href={b.ctaHref}
                className="inline-flex h-10 items-center rounded-md bg-card px-6 text-sm font-medium text-foreground"
              >
                {pick(b.ctaLabel, locale) || t("home.hero.cta")}
              </CtaLink>
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

/** Sections in API order; empty ones are skipped. "How resale works" sits before testimonials. */
export function HomeSections({
  sections,
  locale,
}: {
  sections: HomeSection[];
  locale: Locale;
}) {
  const visible = sections.filter(sectionHasContent);
  const found = visible.findIndex((s) => s.type === "TESTIMONIALS");
  const at = found === -1 ? visible.length : found;
  return (
    <>
      {visible.slice(0, at).map((s) => (
        <SectionBody key={s.id} section={s} locale={locale} />
      ))}
      <HowResale />
      {visible.slice(at).map((s) => (
        <SectionBody key={s.id} section={s} locale={locale} />
      ))}
    </>
  );
}
