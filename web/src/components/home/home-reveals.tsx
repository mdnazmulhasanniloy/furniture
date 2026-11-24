"use client";

import { useEffect } from "react";

import { useMotionPrefs } from "@/lib/use-motion-prefs";

/**
 * Section reveals for the home page (GSAP + ScrollTrigger, ADR-014): every `[data-reveal]` element
 * rises and fades in once when it scrolls into view. Content is fully visible without JavaScript and
 * under prefers-reduced-motion (nothing is hidden up front). Vertical motion only: a horizontal offset on a
 * full-width section would create a transient horizontal scrollbar (worst in RTL), so there is nothing to mirror.
 * GSAP is imported on demand and reverted on unmount.
 */
export function HomeReveals() {
  const { reduced } = useMotionPrefs();

  useEffect(() => {
    if (reduced || typeof window.matchMedia !== "function") return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { gsap } = await import("gsap");
      const { ScrollTrigger } = await import("gsap/ScrollTrigger");
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
          gsap.from(el, {
            opacity: 0,
            y: 36,
            duration: 0.8,
            ease: "power2.out",
            scrollTrigger: { trigger: el, start: "top 88%", once: true },
          });
        });
      });
      cleanup = () => mm.revert();
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [reduced]);

  return null;
}
