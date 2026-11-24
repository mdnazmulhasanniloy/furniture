"use client";

import { motion } from "framer-motion";

import { useMotionPrefs } from "@/lib/use-motion-prefs";

/**
 * Page enter transition (Framer Motion, ADR-014). A template re-mounts on every navigation, so each new
 * page slides in. Enter-only: the App Router cannot animate the page that is leaving. Only `transform`
 * is animated and opacity is never started below 1, so the LCP element is never hidden (PRD G4).
 * Skipped under prefers-reduced-motion.
 */
export default function Template({ children }: Readonly<{ children: React.ReactNode }>) {
  const { reduced } = useMotionPrefs();
  return (
    <motion.div
      data-testid="page-transition"
      initial={reduced ? false : { y: 12 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
