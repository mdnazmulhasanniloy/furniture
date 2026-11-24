"use client";

import { useLocale } from "next-intl";

import { useReducedMotion } from "@/lib/use-reduced-motion";

export type MotionPrefs = {
  /** prefers-reduced-motion: animate opacity only, or not at all. */
  reduced: boolean;
  rtl: boolean;
  /** +1 in LTR, -1 in RTL: multiply every horizontal offset by it so slides mirror (ADR-014). */
  dir: 1 | -1;
};

/** The one hook every animation reads (GSAP, Framer Motion): reduced motion and writing direction. */
export function useMotionPrefs(): MotionPrefs {
  const reduced = useReducedMotion();
  const rtl = useLocale() === "ar";
  return { reduced, rtl, dir: rtl ? -1 : 1 };
}
