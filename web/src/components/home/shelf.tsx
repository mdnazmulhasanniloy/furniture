"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";

import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeProduct } from "@/lib/api/public";
import { useMotionPrefs } from "@/lib/use-motion-prefs";

type Tab = "new" | "resale";

/**
 * The one shelf (ADR-015): a New / Pre-owned segmented switch over one product grid. Arrow keys move
 * between the two options (and in RTL the arrows follow the visual direction). With only one non-empty list the switch is not shown.
 */
export function Shelf({
  newItems,
  resaleItems,
  locale,
}: {
  newItems: HomeProduct[];
  resaleItems: HomeProduct[];
  locale: Locale;
}) {
  const t = useTranslations("home.shelf");
  const nav = useTranslations("nav");
  const { reduced, rtl } = useMotionPrefs();
  const uid = useId();
  const tabs = ([
    { key: "new", label: nav("new"), items: newItems, href: "/shop?type=new" },
    { key: "resale", label: nav("resale"), items: resaleItems, href: "/shop?type=resale" },
  ] as const).filter((x) => x.items.length > 0);
  const [active, setActive] = useState<Tab>(tabs[0]?.key ?? "new");
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  if (tabs.length === 0) return null;
  const current = tabs.find((x) => x.key === active) ?? tabs[0];

  function onKeyDown(e: React.KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((x) => x.key === current.key);
    const step = e.key === "ArrowRight" ? (rtl ? -1 : 1) : e.key === "ArrowLeft" ? (rtl ? 1 : -1) : 0;
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
    setActive(tabs[next].key);
    refs.current[tabs[next].key]?.focus();
  }

  return (
    <section data-testid="home-shelf" aria-labelledby={`${uid}-title`} className="container-wide band">
      <h2 id={`${uid}-title`} className="sr-only">
        {t("title")}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-4">
        {tabs.length > 1 ? (
          <div role="tablist" aria-label={t("title")} onKeyDown={onKeyDown} className="inline-grid grid-cols-2 rounded-md border-[1.5px] border-foreground p-0.5">
            {tabs.map((x) => {
              const on = x.key === current.key;
              return (
                <button
                  key={x.key}
                  ref={(el) => {
                    refs.current[x.key] = el;
                  }}
                  role="tab"
                  type="button"
                  id={`${uid}-${x.key}`}
                  aria-selected={on}
                  aria-controls={`${uid}-panel-${x.key}`}
                  tabIndex={on ? 0 : -1}
                  onClick={() => setActive(x.key)}
                  className="relative grid h-10 min-w-28 place-items-center rounded-[4px] px-5 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {on ? (
                    <motion.span
                      layoutId={`${uid}-pill`}
                      data-testid="shelf-pill"
                      aria-hidden
                      className="absolute inset-0 grid place-items-center rounded-[4px] bg-foreground text-background"
                      transition={{ duration: reduced ? 0 : 0.25, ease: [0.22, 1, 0.36, 1] }}
                    >
                      {x.label}
                    </motion.span>
                  ) : null}
                  <span className={on ? "opacity-0" : undefined}>{x.label}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-3xl font-semibold">{current.label}</p>
        )}
        <Link href={current.href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t(current.key === "new" ? "seeAllNew" : "seeAllResale")}
        </Link>
      </div>
      {tabs.map((x) => (
        <div
          key={x.key}
          role="tabpanel"
          id={`${uid}-panel-${x.key}`}
          aria-labelledby={`${uid}-${x.key}`}
          hidden={x.key !== current.key}
          className="mt-8"
        >
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6">
            {x.items.map((p) => (
              <ConnectedProductCard key={p.id} product={p} locale={locale} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
