"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { getImageProps } from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { CtaLink } from "@/components/home/cta-link";
import { buttonVariants } from "@/components/ui/button";
import type { Banner } from "@/lib/api/public";
import { safeHref } from "@/lib/home";
import { pick } from "@/lib/pick";
import { useCityCount } from "@/lib/site-facts";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/lib/use-reduced-motion";

// ADR-018 / UI-04: a full-bleed carousel. Crossfade 700 ms, slow 6 s zoom, advance after 6 s.
// The progress bar animation IS the timer: a slide advances when its bar finishes (animationend),
// so pausing (hover, focus, the pause button) pauses the bar, the zoom and the timer together.

type Cta = { href: string; label: string };
type Slide = {
  id: string;
  title: string;
  line?: string;
  ctas: Cta[];
  desktop: { src: string; alt: string };
  mobile?: { src: string; alt: string } | null;
};

const SWIPE_PX = 48;
const ctaCls = "h-12 px-8";

/**
 * One <picture> per slide: the browser downloads exactly one source (mobile below 768 px, desktop above), so
 * there is no hidden duplicate image and slide 1 can be eager with a high fetch priority. Built with
 * getImageProps so Next still optimises and resizes. Only slide 1 is eager; the rest are lazy.
 */
function SlidePicture({ slide, first, active }: { slide: Slide; first: boolean; active: boolean }) {
  const base = { fill: true as const, sizes: "100vw", priority: first, loading: first ? undefined : ("lazy" as const) };
  const d = getImageProps({ ...base, src: slide.desktop.src, alt: active ? slide.desktop.alt : "" }).props;
  const m = slide.mobile ? getImageProps({ ...base, src: slide.mobile.src, alt: "" }).props : null;
  return (
    <picture>
      {m ? <source media="(max-width: 767px)" srcSet={m.srcSet} sizes="100vw" /> : null}
      <img
        {...d}
        alt={d.alt}
        loading={first ? "eager" : "lazy"}
        fetchPriority={first ? "high" : undefined}
        className="object-cover object-center"
      />
    </picture>
  );
}

function Slides({ slides, testId }: { slides: Slide[]; testId: string }) {
  const t = useTranslations("home.carousel");
  const locale = useLocale();
  const rtl = locale === "ar";
  const reduced = useReducedMotion();
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const touchX = useRef<number | null>(null);
  // Bytes: only slide 1 is fetched with the page. A slide's photo is mounted once it has been shown, or as the
  // next slide 4 s after load (it then arrives before the 6 s advance). Hidden slides never cost LCP bandwidth.
  const [seen, setSeen] = useState<number[]>([0]);
  const [ahead, setAhead] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setAhead(true), 4000);
    return () => window.clearTimeout(id);
  }, []);
  const current = Math.min(index, count - 1);

  const autoplay = count > 1 && !reduced;
  const running = autoplay && !userPaused;
  const paused = !running || hover || focus; // visual and timer pause (animation-play-state)

  const go = useCallback(
    (i: number) => {
      const n = ((i % count) + count) % count;
      setIndex(n);
      setSeen((v) => (v.includes(n) ? v : [...v, n]));
    },
    [count],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (count < 2) return;
    if (e.key === "ArrowRight") go(current + (rtl ? -1 : 1));
    else if (e.key === "ArrowLeft") go(current + (rtl ? 1 : -1));
  }

  return (
    <section
      data-testid={testId}
      data-running={running && !paused}
      aria-roledescription="carousel"
      aria-label={t("label")}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        touchX.current = null;
        const end = e.changedTouches[0]?.clientX;
        if (start == null || end == null || count < 2) return;
        const dx = end - start;
        if (Math.abs(dx) < SWIPE_PX) return;
        go(current + ((dx < 0) !== rtl ? 1 : -1));
      }}
      className="group/hero relative isolate h-[70vh] min-h-[480px] w-full overflow-hidden bg-gradient-to-br from-primary to-foreground text-primary-foreground md:h-[85vh]"
    >
      <div aria-live={running ? "off" : "polite"} className="absolute inset-0">
        {slides.map((s, i) => {
          const active = i === current;
          const first = i === 0;
          const mountImage = seen.includes(i) || (ahead && i === (current + 1) % count);
          return (
            <div
              key={s.id}
              role="group"
              aria-roledescription="slide"
              aria-label={t("slide", { n: i + 1, total: count })}
              aria-hidden={active ? undefined : true}
              inert={!active}
              data-active={active}
              className={cn(
                "absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none",
                active ? "opacity-100" : "pointer-events-none opacity-0",
              )}
            >
              <div
                className={cn(
                  "absolute inset-0",
                  active && autoplay && !reduced && "hero-zoom",
                )}
                style={active && autoplay && !reduced ? { animationPlayState: paused ? "paused" : "running" } : undefined}
              >
                {mountImage ? <SlidePicture slide={s} first={first} active={active} /> : null}
              </div>
              {/* Scrim: ink at 60 to 80 % behind the text block keeps white text above 4.5:1 on any photo. */}
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-foreground/80 via-foreground/60 via-55% to-transparent" />
              <div className="container-wide absolute inset-x-0 bottom-0 pb-24 md:pb-28">
                <div className="max-w-2xl">
                  {active ? (
                    <h1 className="type-hero">{s.title}</h1>
                  ) : (
                    <p className="type-hero">{s.title}</p>
                  )}
                  {s.line ? <p className="mt-4 max-w-xl text-lg">{s.line}</p> : null}
                  {s.ctas.length > 0 ? (
                    <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                      {s.ctas.map((c, k) => (
                        <CtaLink
                          key={c.href + c.label}
                          href={c.href}
                          className={cn(
                            buttonVariants({ variant: k === 0 ? "default" : "outline" }),
                            ctaCls,
                            k === 0
                              ? "bg-primary-foreground text-foreground hover:bg-primary-foreground/90"
                              : "border-primary-foreground bg-transparent text-primary-foreground hover:bg-primary-foreground/10",
                          )}
                        >
                          {c.label}
                        </CtaLink>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {count > 1 ? (
        <div className="container-wide absolute inset-x-0 bottom-0 flex items-center gap-4 pb-6 md:pb-8">
          <div className="flex flex-1 gap-2">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={t("goTo", { n: i + 1 })}
                aria-current={i === current}
                onClick={() => go(i)}
                className="flex h-8 max-w-24 flex-1 items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              >
                <span className="relative block h-0.5 w-full overflow-hidden bg-primary-foreground/40">
                  <span
                    data-testid={i === current ? "hero-progress" : undefined}
                    onAnimationEnd={() => i === current && go(current + 1)}
                    className={cn(
                      "hero-bar-fill absolute inset-0 block bg-primary-foreground",
                      i > current && "scale-x-0",
                      i === current && autoplay && "hero-bar",
                    )}
                    style={i === current && autoplay ? { animationPlayState: paused ? "paused" : "running" } : undefined}
                  />
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {autoplay ? (
              <button
                type="button"
                aria-label={userPaused ? t("play") : t("pause")}
                aria-pressed={userPaused}
                onClick={() => setUserPaused((p) => !p)}
                className="flex size-11 items-center justify-center rounded-full border border-primary-foreground/60 hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
              >
                {userPaused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
              </button>
            ) : null}
            <button
              type="button"
              aria-label={t("previous")}
              onClick={() => go(current - 1)}
              className="flex size-11 items-center justify-center rounded-full border border-primary-foreground/60 hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
            >
              <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("next")}
              onClick={() => go(current + 1)}
              className="flex size-11 items-center justify-center rounded-full border border-primary-foreground/60 hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-foreground"
            >
              <ChevronRight className="size-5 rtl:rotate-180" aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Hero from the active banners (ADM-06). One button per banner (CR-011 Q-3). */
export function Hero({ banners }: { banners: Banner[] }) {
  const t = useTranslations("home.hero");
  const locale = useLocale();
  if (banners.length === 0) return null;
  const slides: Slide[] = banners.map((b) => {
    const safe = safeHref(b.ctaHref);
    const alt = pick(b.imageDesktop.alt, locale);
    return {
      id: b.id,
      title: pick(b.title, locale),
      line: pick(b.subtitle, locale) || undefined,
      ctas: safe
        ? [{ href: b.ctaHref as string, label: pick(b.ctaLabel, locale) || t("shopNew") }]
        : [{ href: "/shop?type=new", label: t("shopNew") }],
      desktop: { src: b.imageDesktop.url, alt },
      mobile: b.imageMobile?.url ? { src: b.imageMobile.url, alt: pick(b.imageMobile.alt, locale) || alt } : null,
    };
  });
  return <Slides slides={slides} testId="home-hero" />;
}

/** No active banner (or API unreachable): three static slides, so the page is never blank. */
export function HeroFallback() {
  const t = useTranslations("home.carousel");
  const cityCount = useCityCount();
  const slides: Slide[] = [
    { n: 1, a: "/shop?type=new", b: "/shop" },
    { n: 2, a: "/shop?type=resale", b: "/#how-resale" },
    { n: 3, a: "/#how-resale", b: null },
  ].map(({ n, a, b }) => ({
    id: `static-${n}`,
    title: t(`s${n}.title`),
    // slide 3 states the number of active delivery cities; with no count it shows no line (never a guess)
    line: n === 3 ? (cityCount > 0 ? t("s3.line", { count: cityCount }) : undefined) : t(`s${n}.line`),
    ctas: [
      { href: a, label: t(`s${n}.cta`) },
      ...(b ? [{ href: b, label: t(`s${n}.cta2`) }] : []),
    ],
    desktop: { src: `/home/slide-${n}.jpg`, alt: "" }, // decorative: the slide title carries the meaning
  }));
  return <Slides slides={slides} testId="home-fallback-hero" />;
}
