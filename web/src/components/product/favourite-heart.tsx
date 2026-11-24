"use client";

import { motion } from "framer-motion";
import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import { useMotionPrefs } from "@/lib/use-motion-prefs";
import { cn } from "@/lib/utils";

/** Animated heart toggle (PROD-01, FAV-01). Controlled: the parent owns the state. */
export function FavouriteHeart({
  active,
  onToggle,
  className,
}: {
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations("favourites");
  const { reduced } = useMotionPrefs();
  return (
    <button
      type="button"
      data-testid="favourite-toggle"
      aria-pressed={active}
      aria-label={active ? t("remove") : t("add")}
      onClick={onToggle}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full bg-card text-foreground transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <motion.span
        aria-hidden
        className="inline-flex"
        animate={reduced ? undefined : { scale: active ? [1, 1.35, 1] : 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        key={active ? "on" : "off"}
      >
        <Heart className={cn("size-4", active && "fill-destructive text-destructive")} />
      </motion.span>
    </button>
  );
}
