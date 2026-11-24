import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type Focal = { x: number; y: number } | null;

/** CSS object-position for a focal point in percent; null = centre (the storefront does the same). */
export const objectPosition = (f: Focal | undefined) => (f ? `${f.x}% ${f.y}%` : "50% 50%");

/**
 * Live preview of ONE storefront hero slide (UI-04): full-bleed photo with its focal point, a dark scrim at the
 * bottom (and a light one at the top for the floating header), a serif-style title, one line and one button, text at
 * the bottom-start. It uses the same layers and token classes as web/src/components/home/hero.tsx, so what the
 * admin sees is what the visitor gets. `device` switches between the desktop slide (wide) and the mobile slide.
 */
export function HeroPreview({
  device,
  lang,
  title,
  subtitle,
  cta,
  src,
  focal,
}: {
  device: "desktop" | "mobile";
  lang: "en" | "ar";
  title: string;
  subtitle: string;
  cta: string;
  src: string | null;
  focal: Focal;
}) {
  const { t } = useTranslation();
  const mobile = device === "mobile";
  return (
    <div
      data-testid="hero-preview"
      data-device={device}
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      className={cn(
        "relative isolate mx-auto overflow-hidden rounded-lg bg-foreground text-primary-foreground",
        mobile ? "aspect-[2/3] w-[17rem]" : "aspect-[16/9] w-full",
      )}
    >
      {src ? (
        <img
          src={src}
          alt=""
          data-testid="hero-preview-image"
          className="absolute inset-0 size-full object-cover"
          style={{ objectPosition: objectPosition(focal) }}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-sm opacity-80" data-testid="hero-preview-empty">
          {t("banners.form.desktopRequired")}
        </div>
      )}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[70%] bg-gradient-to-t from-foreground/80 via-foreground/60 via-55% to-transparent" />
      <div aria-hidden className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-foreground/60 to-transparent" />
      <div className={cn("absolute inset-x-0 bottom-0", mobile ? "p-4 pb-9" : "p-6 pb-11")}>
        <p
          data-testid="hero-preview-title"
          className={cn("font-display font-bold leading-tight", mobile ? "text-2xl" : "text-4xl")}
        >
          {title}
        </p>
        {subtitle ? <p className={cn("mt-2", mobile ? "text-sm" : "text-base")}>{subtitle}</p> : null}
        {cta ? (
          <span
            data-testid="hero-preview-cta"
            className={cn("mt-4 inline-block rounded-md bg-primary-foreground font-medium text-foreground", mobile ? "px-4 py-2 text-sm" : "px-6 py-2.5 text-sm")}
          >
            {cta}
          </span>
        ) : null}
      </div>
      <div aria-hidden className="absolute inset-x-4 bottom-3 flex gap-2">
        <span className="h-0.5 flex-1 bg-primary-foreground" />
        <span className="h-0.5 flex-1 bg-primary-foreground/40" />
      </div>
    </div>
  );
}
