"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

const STEPS = ["browse", "grade", "deliver"] as const;

/**
 * "How resale works" — 3 steps. On md+ with motion allowed, GSAP ScrollTrigger pins the
 * section and lights the steps one by one; otherwise it is a plain static list.
 */
export function HowResale() {
  const t = useTranslations("home.resale");
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof window.matchMedia !== "function") return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add("(min-width: 768px) and (prefers-reduced-motion: no-preference)", () => {
        const steps = el.querySelectorAll("[data-step]");
        gsap.set(steps, { opacity: 0.35 });
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: el,
            start: "top top",
            end: "+=900",
            pin: true,
            scrub: true,
          },
        });
        steps.forEach((step) => tl.to(step, { opacity: 1, duration: 1 }));
        tl.to({}, { duration: 0.5 });
      });
      cleanup = () => mm.revert();
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <section
      ref={root}
      data-testid="how-resale"
      aria-labelledby="how-resale-title"
      className="bg-muted py-16 md:flex md:min-h-screen md:items-center"
    >
      <div className="mx-auto w-full max-w-7xl px-4">
        <h2 id="how-resale-title" className="font-display text-3xl font-semibold">
          {t("title")}
        </h2>
        <p className="mt-2 max-w-xl text-muted-foreground">{t("subtitle")}</p>
        <ol className="mt-10 grid gap-6 md:grid-cols-3">
          {STEPS.map((key, i) => (
            <li key={key} data-step className="rounded-lg border border-border bg-card p-6">
              <span className="text-sm font-medium text-primary">{t("step", { n: i + 1 })}</span>
              <h3 className="mt-2 text-lg font-semibold">{t(`steps.${key}.title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`steps.${key}.body`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
