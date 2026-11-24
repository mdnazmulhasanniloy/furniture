"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * A horizontal rail (ADR-018 / UI-04): no native scrollbar, snap kept, arrow buttons (shown only when there is
 * more to scroll in that direction) and arrow keys. Scrolls by about one viewport of the rail; mirrors in RTL.
 * Arrow labels reuse the approved carousel strings (home.carousel.previous / next).
 */
export function Rail({
  children,
  label,
  className,
  testId,
}: {
  children: React.ReactNode;
  label: string;
  className?: string;
  testId?: string;
}) {
  const t = useTranslations("home.carousel");
  const rtl = useLocale() === "ar";
  const ref = useRef<HTMLUListElement>(null);
  const [can, setCan] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const pos = Math.abs(el.scrollLeft); // negative in RTL: distance from the inline start
    setCan({ start: pos > 4, end: pos < max - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, children]);

  function scrollBy(direction: 1 | -1) {
    const el = ref.current;
    if (!el) return;
    // direction 1 = toward the inline end; the x axis is flipped in RTL
    el.scrollBy({ left: direction * (rtl ? -1 : 1) * el.clientWidth * 0.85, behavior: "smooth" });
  }

  return (
    <div className="relative">
      <ul
        ref={ref}
        aria-label={label}
        data-testid={testId}
        tabIndex={0}
        onScroll={measure}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            scrollBy((e.key === "ArrowRight") !== rtl ? 1 : -1);
          }
        }}
        className={cn("rail-scroll flex gap-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", className)}
      >
        {children}
      </ul>
      {(["start", "end"] as const).map((side) =>
        can[side] ? (
          <button
            key={side}
            type="button"
            aria-label={side === "start" ? t("previous") : t("next")}
            onClick={() => scrollBy(side === "start" ? -1 : 1)}
            className={cn(
              "absolute top-1/3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-float hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:flex",
              side === "start" ? "start-2" : "end-2",
            )}
          >
            {(side === "start") !== rtl ? <ChevronLeft className="size-5" aria-hidden /> : <ChevronRight className="size-5" aria-hidden />}
          </button>
        ) : null,
      )}
    </div>
  );
}
