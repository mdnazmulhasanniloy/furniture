import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

// T-085 step 6. What the website will show. The admin and the storefront are separate apps, so this is a
// copy of the storefront's markup rules (web/src/components/home/shop-the-look.tsx) rather than a shared
// component; `t085-look-preview.test.tsx` pins the facts that decide where a dot lands in both files.
//
// The rules: the photo is shown at its own ratio and never cropped, and a dot is a physical left/top
// percentage of that box - `start`/`end` would mirror in Arabic and move every dot off its object.

const PHONE_WIDTH = 390;

export type PreviewPoint = { id: string; x: number; y: number };

export function LookPreview({
  device,
  onDevice,
  src,
  alt,
  width,
  height,
  points,
  title,
  subtitle,
}: {
  device: "desktop" | "mobile";
  onDevice: (d: "desktop" | "mobile") => void;
  src: string | null;
  alt: string;
  width: number | null;
  height: number | null;
  points: PreviewPoint[];
  title: string;
  subtitle: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const ratio = width && height ? `${width} / ${height}` : null;

  return (
    <aside className="lg:sticky lg:top-4 lg:self-start" data-testid="look-preview">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("sections.looks.editor.preview")}</h2>
        <div role="group" aria-label={t("sections.looks.editor.preview")} className="flex gap-1">
          {(["desktop", "mobile"] as const).map((d) => (
            <Button
              key={d}
              type="button"
              size="sm"
              variant={device === d ? "default" : "outline"}
              aria-pressed={device === d}
              onClick={() => onDevice(d)}
              data-testid={`look-preview-${d}`}
            >
              {t(`sections.looks.editor.${d}`)}
            </Button>
          ))}
        </div>
      </div>
      <div
        className="mx-auto overflow-hidden rounded-lg border border-border bg-background p-4"
        style={device === "mobile" ? { width: PHONE_WIDTH } : undefined}
        data-testid="preview-frame"
        dir={locale === "ar" ? "rtl" : "ltr"}
      >
        <h3 className="font-display text-xl font-semibold">{title}</h3>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        {src ? (
          <div
            className={cn("relative mt-4 overflow-hidden rounded-lg bg-muted", !ratio && "aspect-[4/5] sm:aspect-[16/9]")}
            style={ratio ? { aspectRatio: ratio } : undefined}
            data-testid="preview-photo"
          >
            <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
            {points.map((p, i) => (
              <span
                key={p.id}
                data-testid="preview-dot"
                style={{ left: `${p.x}%`, top: `${p.y}%` }}
                className="absolute -ml-3.5 -mt-3.5 flex size-7 items-center justify-center rounded-full bg-background ring-2 ring-foreground"
              >
                <span aria-hidden className="size-2.5 rounded-full bg-foreground" />
                <span className="sr-only">{i + 1}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{t("sections.looks.editor.photoRequired")}</p>
        )}
      </div>
    </aside>
  );
}
