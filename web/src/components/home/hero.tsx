"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { CtaLink } from "@/components/home/cta-link";
import type { Banner } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const AUTO_ADVANCE_MS = 6000;

/** Hero carousel from the active banners (W-01). GSAP: headline stagger + image parallax. */
export function Hero({ banners }: { banners: Banner[] }) {
  const t = useTranslations("home.hero");
  const locale = useLocale();
  const reduced = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;
  const banner = banners[Math.min(index, count - 1)];

  // Auto-advance only when motion is allowed and the user is not interacting.
  useEffect(() => {
    if (count < 2 || reduced || paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [count, reduced, paused]);

  // GSAP is loaded on demand (home only). x offsets flip in RTL (CLAUDE.md rule 3).
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || typeof window.matchMedia !== "function") return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const dir = document.documentElement.dir === "rtl" ? -1 : 1;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(el.querySelectorAll("[data-hero-line]"), {
          opacity: 0,
          x: 28 * dir,
          y: 12,
          duration: 0.7,
          stagger: 0.12,
          ease: "power2.out",
        });
        const image = el.querySelector("[data-hero-image]");
        if (image) {
          gsap.to(image, {
            yPercent: 10,
            ease: "none",
            scrollTrigger: { trigger: el, start: "top top", end: "bottom top", scrub: true },
          });
        }
      });
      cleanup = () => mm.revert();
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [index, reduced]);

  if (!banner) return null;
  const title = pick(banner.title, locale);
  const subtitle = pick(banner.subtitle, locale);
  const ctaLabel = pick(banner.ctaLabel, locale);
  const mobile = banner.imageMobile?.url;

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label={t("label")}
      data-testid="home-hero"
      className="relative isolate overflow-hidden bg-muted"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        key={banner.id}
        role="group"
        aria-roledescription="slide"
        aria-label={t("slide", { current: index + 1, total: count })}
        className="relative min-h-[26rem] md:min-h-[32rem]"
      >
        <div data-hero-image className="absolute inset-x-0 -top-8 -bottom-8 -z-10">
          {mobile ? (
            <Image
              src={mobile}
              alt=""
              fill
              priority={index === 0}
              sizes="100vw"
              className="object-cover md:hidden"
            />
          ) : null}
          <Image
            src={banner.imageDesktop.url}
            alt={pick(banner.imageDesktop.alt, locale)}
            fill
            priority={index === 0}
            sizes="100vw"
            className={mobile ? "hidden object-cover md:block" : "object-cover"}
          />
          <div className="absolute inset-0 bg-foreground/45" aria-hidden />
        </div>
        <div className="mx-auto flex min-h-[inherit] max-w-7xl flex-col justify-end gap-4 px-4 pb-16 pt-24 text-primary-foreground">
          <h1
            data-hero-line
            className="font-display max-w-2xl text-4xl font-semibold leading-tight md:text-5xl"
          >
            {title}
          </h1>
          {subtitle ? (
            <p data-hero-line className="max-w-xl text-lg">
              {subtitle}
            </p>
          ) : null}
          <CtaLink
            href={banner.ctaHref}
            className="shimmer relative inline-flex h-11 w-fit items-center justify-center overflow-hidden rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span data-hero-line>{ctaLabel || t("cta")}</span>
          </CtaLink>
        </div>
      </div>
      {count > 1 ? (
        <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3">
          <button
            type="button"
            aria-label={t("prev")}
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
            className="rounded-full bg-card/80 p-2 text-foreground"
          >
            <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
          </button>
          <div className="flex gap-2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`size-2.5 rounded-full ${i === index ? "bg-primary" : "bg-card/70"}`}
              />
            ))}
          </div>
          <button
            type="button"
            aria-label={t("next")}
            onClick={() => setIndex((i) => (i + 1) % count)}
            className="rounded-full bg-card/80 p-2 text-foreground"
          >
            <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>
      ) : null}
    </section>
  );
}
