"use client";

import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { useRef, useState } from "react";

import type { ImageAsset } from "@/lib/api/public";
import { pick } from "@/lib/pick";

const SWIPE_PX = 40;

/**
 * PROD-02 gallery: a 4:5 image on sand (photo multiplied onto it, square corners), a row of thumbnails
 * under it, prev/next buttons, swipe on touch, click-to-zoom on desktop (pointer position moves the image).
 */
export function Gallery({
  images,
  title,
  locale,
}: {
  images: ImageAsset[];
  title: string;
  locale: string;
}) {
  const t = useTranslations("product.gallery");
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const touchX = useRef<number | null>(null);
  const total = images.length;

  if (total === 0) {
    return (
      <div
        className="flex aspect-[4/5] items-center justify-center bg-muted text-sm text-muted-foreground"
        data-testid="gallery-empty"
      >
        {t("noImage")}
      </div>
    );
  }

  const rtl = () => document.documentElement.dir === "rtl";
  const go = (next: number) => {
    setZoom(null);
    setIndex((next + total) % total);
  };
  const current = images[index];
  const alt = (img: ImageAsset) => pick(img.alt, locale) || title;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t("label")}
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") go(index + (rtl() ? -1 : 1));
        else if (e.key === "ArrowLeft") go(index + (rtl() ? 1 : -1));
        else if (e.key === "Escape") setZoom(null);
      }}
    >
      <div className="relative min-w-0 flex-1">
        <div
          className="relative aspect-[4/5] overflow-hidden bg-muted"
          data-testid="gallery-main"
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touchX.current;
            touchX.current = null;
            const end = e.changedTouches[0]?.clientX;
            if (start == null || end == null || total < 2) return;
            const dx = end - start;
            if (Math.abs(dx) < SWIPE_PX) return;
            // Swiping toward the start edge shows the next image (flips in RTL).
            const forward = rtl() ? dx > 0 : dx < 0;
            go(index + (forward ? 1 : -1));
          }}
          onMouseMove={(e) => {
            if (!zoom) return;
            const r = e.currentTarget.getBoundingClientRect();
            setZoom({
              x: ((e.clientX - r.left) / r.width) * 100,
              y: ((e.clientY - r.top) / r.height) * 100,
            });
          }}
        >
          <Image
            key={current.url}
            src={current.url}
            alt={alt(current)}
            fill
            priority={index === 0}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover mix-blend-multiply motion-reduce:transition-none"
            style={
              zoom
                ? { transform: "scale(2)", transformOrigin: `${zoom.x}% ${zoom.y}%` }
                : undefined
            }
          />
          <button
            type="button"
            onClick={() => setZoom(zoom ? null : { x: 50, y: 50 })}
            aria-pressed={zoom !== null}
            aria-label={zoom ? t("zoomOut") : t("zoomIn")}
            className="absolute bottom-3 end-3 hidden size-9 items-center justify-center rounded-full bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          >
            {zoom ? <ZoomOut className="size-4" aria-hidden /> : <ZoomIn className="size-4" aria-hidden />}
          </button>
          {total > 1 ? (
            <>
              <button
                type="button"
                onClick={() => go(index - 1)}
                aria-label={t("prev")}
                className="absolute start-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => go(index + 1)}
                aria-label={t("next")}
                className="absolute end-3 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      </div>
      {total > 1 ? (
        <ul
          aria-label={t("thumbs")}
          className="rail-scroll flex gap-2 pb-1"
        >
          {images.map((img, i) => (
            <li key={`${img.url}-${i}`} className="shrink-0">
              <button
                type="button"
                onClick={() => go(i)}
                aria-label={t("thumb", { n: i + 1, total })}
                aria-current={i === index ? "true" : undefined}
                className={`relative block size-16 overflow-hidden border-2 bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:size-20 ${
                  i === index ? "border-primary" : "border-transparent"
                }`}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
