"use client";

import AOS from "aos";
import "aos/dist/aos.css";
import { useEffect } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * AOS for content-page reveals (static pages, account headings; ADR-014): fade-up, once, offset 80,
 * 600 ms. AOS hides every data-aos element until it animates, so the attribute is only added here,
 * after mount, and only to blocks that start below the first screen: nothing above the fold is ever
 * hidden (LCP, PRD G4) and without JavaScript or under prefers-reduced-motion nothing is hidden at all.
 * Mark a block with data-aos-reveal, or a container whose children should reveal with data-aos-group.
 * Vertical motion only, so nothing needs mirroring in RTL.
 */
export function AosInit() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const below = (el: Element) => el.getBoundingClientRect().top > window.innerHeight - 40;
    const targets = [
      ...document.querySelectorAll("[data-aos-reveal]"),
      ...Array.from(document.querySelectorAll("[data-aos-group]")).flatMap((g) => Array.from(g.children)),
    ];
    for (const el of targets) if (below(el)) el.setAttribute("data-aos", "fade-up");
    AOS.init({ once: true, offset: 80, duration: 600, easing: "ease-out-cubic" });
  }, [reduced]);
  return null;
}
