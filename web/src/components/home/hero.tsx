"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Arch } from "@/components/arch";
import { ImagePlaceholder } from "@/components/brand";
import { CtaLink } from "@/components/home/cta-link";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Banner } from "@/lib/api/public";
import { safeHref } from "@/lib/home";
import { pick } from "@/lib/pick";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const ROTATE_MS = 7000;
const actionCls = "h-12 w-full px-8 sm:w-auto";

/**
 * The one orchestrated moment of the site (ADR-015, design-system section 7), once on home load:
 * the arch clip grows from its base (700 ms), the gold outline draws, the headline settles (rises 16 px).
 * The image is already painted (LCP): the timeline only animates clip-path, opacity and transform, and
 * clears its inline styles at the end. Skipped completely under prefers-reduced-motion.
 */
function useArchMoment(root: React.RefObject<HTMLElement | null>) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = root.current;
    if (!el || reduced) return;
    let cancelled = false;
    let revert: (() => void) | undefined;
    void (async () => {
      const { gsap } = await import("gsap");
      if (cancelled) return;
      const ctx = gsap.context(() => {
        const open = "inset(0% 0% 0% 0%)";
        const closed = "inset(100% 0% 0% 0%)";
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.fromTo("[data-arch-reveal]", { clipPath: closed }, { clipPath: open, duration: 0.7, clearProps: "clipPath" })
          .fromTo(
            "[data-arch-outline]",
            { clipPath: closed },
            { clipPath: open, duration: 0.6, ease: "power2.inOut", clearProps: "clipPath" },
            "-=0.25",
          )
          .from(
            "[data-hero-line]",
            { opacity: 0, y: 16, duration: 0.5, stagger: 0.08, clearProps: "opacity,transform" },
            "-=0.3",
          );
      }, el);
      revert = () => ctx.revert();
    })();
    return () => {
      cancelled = true;
      revert?.();
    };
  }, [root, reduced]);
}

function Actions({ primary }: { primary?: { href: string | null | undefined; label: string } }) {
  const t = useTranslations("home.hero");
  const secondary = cn(buttonVariants({ variant: "secondary" }), actionCls);
  const primaryCls = cn(buttonVariants(), actionCls);
  return (
    <div data-hero-line className="mt-8 flex flex-col gap-3 sm:flex-row">
      {primary && safeHref(primary.href) ? (
        <CtaLink href={primary.href} className={primaryCls}>
          {primary.label}
        </CtaLink>
      ) : (
        <Link href="/shop?type=new" className={primaryCls}>
          {t("shopNew")}
        </Link>
      )}
      <Link href="/shop?type=resale" className={secondary}>
        {t("shopResale")}
      </Link>
    </div>
  );
}

function HeroFrame({
  root,
  testId,
  headline,
  sentence,
  actions,
  art,
  below,
  ...aria
}: {
  root: React.RefObject<HTMLElement | null>;
  testId: string;
  headline: string;
  sentence?: string;
  actions: React.ReactNode;
  art: React.ReactNode;
  below?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section ref={root} data-testid={testId} className="overflow-x-clip" {...aria}>
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-10 md:px-8 md:py-16 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <div>
          <h1 data-hero-line className="type-hero measure">
            {headline}
          </h1>
          {sentence ? (
            <p data-hero-line className="measure mt-6 text-lg text-muted-foreground">
              {sentence}
            </p>
          ) : null}
          {actions}
        </div>
        <div className="mx-auto w-full max-w-md lg:me-0 lg:ms-auto">
          <Arch ratio="4/5" outline>
            {art}
          </Arch>
          {below}
        </div>
      </div>
    </section>
  );
}

/** Hero from the active banners (W-01): arched image, headline, two actions. Crossfade every 7 s. */
export function Hero({ banners }: { banners: Banner[] }) {
  const t = useTranslations("home.hero");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;
  const current = Math.min(index, Math.max(count - 1, 0));
  const banner = banners[current];

  useArchMoment(root);

  // Auto-rotate only when motion is allowed and the user is not hovering or focused inside the hero.
  useEffect(() => {
    if (count < 2 || reduced || paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [count, reduced, paused]);

  if (!banner) return null;
  const sentence = pick(banner.subtitle, locale);
  const ctaLabel = pick(banner.ctaLabel, locale) || t("shopNew");

  return (
    <HeroFrame
      root={root}
      testId="home-hero"
      aria-roledescription="carousel"
      aria-label={t("label")}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      headline={pick(banner.title, locale)}
      sentence={sentence || undefined}
      actions={<Actions key={banner.id} primary={{ href: banner.ctaHref, label: ctaLabel }} />}
      art={
        <div data-arch-reveal className="absolute inset-0">
          {banners.map((b, i) => {
            const active = i === current;
            const mobile = b.imageMobile?.url;
            return (
              <div
                key={b.id}
                role="group"
                aria-roledescription="slide"
                aria-label={t("slide", { current: i + 1, total: count })}
                aria-hidden={active ? undefined : true}
                data-active={active}
                className={cn(
                  "absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none",
                  active ? "opacity-100" : "opacity-0",
                )}
              >
                {mobile ? (
                  <Image
                    src={mobile}
                    alt={active ? pick(b.imageDesktop.alt, locale) : ""}
                    fill
                    priority={i === 0}
                    sizes="(min-width: 1024px) 28rem, 90vw"
                    className="object-cover object-center md:hidden"
                  />
                ) : null}
                <Image
                  src={b.imageDesktop.url}
                  alt={active ? pick(b.imageDesktop.alt, locale) : ""}
                  fill
                  priority={i === 0}
                  sizes="(min-width: 1024px) 28rem, 90vw"
                  className={cn("object-cover object-center", mobile && "hidden md:block")}
                />
              </div>
            );
          })}
        </div>
      }
      below={
        count > 1 ? (
          <div className="mt-6 flex justify-center gap-1">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === current}
                onClick={() => setIndex(i)}
                className="flex size-6 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("size-2.5 rounded-full", i === current ? "bg-primary" : "bg-stone")} />
              </button>
            ))}
          </div>
        ) : null
      }
    />
  );
}

/** No active banner (or API unreachable): the same composition with the default copy, so the page is never blank. */
export function HeroFallback() {
  const t = useTranslations("home");
  const root = useRef<HTMLElement>(null);
  useArchMoment(root);
  return (
    <HeroFrame
      root={root}
      testId="home-fallback-hero"
      headline={t("hero.headline")}
      sentence={t("hero.sentence")}
      actions={<Actions />}
      art={
        <div data-arch-reveal className="absolute inset-0">
          <ImagePlaceholder name={t("brand")} />
        </div>
      }
    />
  );
}
