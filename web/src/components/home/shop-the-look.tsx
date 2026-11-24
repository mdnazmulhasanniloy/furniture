"use client";

import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

import { Price } from "@/components/format";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeSection } from "@/lib/api/public";
import { flyToCart } from "@/lib/cart/fly";
import { addToCart } from "@/lib/cart/store";
import { pick } from "@/lib/pick";

type Look = NonNullable<HomeSection["look"]>;

/**
 * "Shop the look" (ADM-15, UI-04): one room photo with 1 to 4 hotspots. Hotspots are real buttons positioned in
 * percent over the photo; Enter, Space or a tap toggles a small product card (aria-expanded and aria-controls),
 * Escape closes it and returns focus, one card is open at a time, and the card flips so it never leaves the photo.
 */
export function ShopTheLook({ section, locale }: { section: HomeSection; locale: Locale }) {
  const t = useTranslations("home.look");
  const tc = useTranslations();
  const look = section.look as Look;
  const uid = useId();
  const [open, setOpen] = useState<number | null>(null);
  const triggers = useRef<(HTMLButtonElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const lang = useLocale();
  const title = pick(section.title, lang) || t("title");

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const i = open;
        setOpen(null);
        triggers.current[i]?.focus();
      }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  return (
    <section data-testid="home-section-SHOP_THE_LOOK" aria-labelledby={`${uid}-title`} className="container-wide band">
      <h2 id={`${uid}-title`} className="text-3xl md:text-4xl">
        {title}
      </h2>
      <p className="mt-2 text-base text-muted-foreground">{t("hint")}</p>
      <div ref={root} className="relative mt-8 aspect-[4/5] overflow-hidden rounded-lg bg-muted sm:aspect-[16/9]" data-testid="look-photo">
        <Image
          src={look.image.url}
          alt={pick(look.image.alt, lang)}
          fill
          quality={60}
          sizes="(min-width: 1440px) 1344px, 100vw"
          className="object-cover"
          loading="lazy"
        />
        {look.hotspots.map((h, i) => {
          const name = pick(h.product.title, lang);
          const isOpen = open === i;
          const panelId = `${uid}-card-${i}`;
          // Coordinates are positions on the photo itself, so they are physical (left/right), not mirrored in RTL.
          // The card opens toward the middle of the photo so it never leaves it.
          const right = h.x > 50;
          const below = h.y < 50;
          return (
            <div key={`${h.product.id}-${i}`} className="absolute" style={{ left: `${h.x}%`, top: `${h.y}%` }}>
              <button
                ref={(el) => {
                  triggers.current[i] = el;
                }}
                type="button"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-label={t("hotspot", { name })}
                data-testid="hotspot"
                onClick={() => setOpen(isOpen ? null : i)}
                className="-ml-3.5 -mt-3.5 flex size-7 items-center justify-center rounded-full bg-background ring-2 ring-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span aria-hidden className="size-2.5 rounded-full bg-foreground" />
              </button>
              {isOpen ? (
                <div
                  id={panelId}
                  role="group"
                  aria-label={name}
                  data-testid="look-card"
                  className={[
                    "absolute z-10 w-60 rounded-lg bg-card p-3 text-card-foreground shadow-float",
                    right ? "right-0" : "left-0",
                    below ? "top-8" : "bottom-8",
                  ].join(" ")}
                >
                  <div className="flex gap-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-sm bg-muted">
                      {h.product.images?.[0] ? (
                        <Image src={h.product.images[0].url} alt="" fill sizes="64px" className="object-cover" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <Link href={`/shop/${encodeURIComponent(h.product.slug)}`} className="line-clamp-2 text-base font-semibold hover:underline">
                        {name}
                      </Link>
                      <p className="mt-1 text-base font-semibold">
                        <Price halalas={h.product.price} locale={locale} />
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={h.product.stock <= 0}
                    onClick={async (e) => {
                      const from = e.currentTarget;
                      if (await addToCart(h.product, 1)) flyToCart(from);
                    }}
                  >
                    {h.product.stock <= 0 ? tc("badge.soldOut") : tc("cart.addToCart")}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
