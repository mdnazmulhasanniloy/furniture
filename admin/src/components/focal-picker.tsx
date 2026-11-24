import { LocateFixed } from "lucide-react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Focal } from "@/components/hero-preview";

const clamp = (n: number) => Math.min(100, Math.max(0, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Focal-point picker (CR-011 Q-5, no crop library): the WHOLE photo is shown; a click or tap sets the point that must
 * stay visible when the storefront crops the photo (stored as focalX / focalY percent, applied as object-position at
 * every breakpoint). The marker is a button: arrow keys move it by 1 percent (Shift: 10), Home or Escape reset it.
 */
export function FocalPicker({
  src,
  value,
  onChange,
  testId,
  label,
}: {
  src: string;
  value: Focal;
  onChange: (f: Focal) => void;
  testId: string;
  label: string;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const point = value ?? { x: 50, y: 50 };

  const setFromEvent = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return;
    onChange({ x: round1(clamp(((clientX - r.left) / r.width) * 100)), y: round1(clamp(((clientY - r.top) / r.height) * 100)) });
  };

  return (
    <div data-testid={testId} className="mt-2">
      <p className="text-sm font-medium">{t("banners.focal.title")}</p>
      <p className="text-xs text-muted-foreground">{t("banners.focal.hint")}</p>
      <div
        ref={box}
        data-testid={`${testId}-surface`}
        className="relative mt-2 inline-block max-w-full cursor-crosshair overflow-hidden rounded-md border border-border"
        onClick={(e) => setFromEvent(e.clientX, e.clientY)}
      >
        <img src={src} alt="" className="block max-h-56 max-w-full select-none" draggable={false} />
        <button
          type="button"
          data-testid={`${testId}-marker`}
          aria-label={`${label}: ${point.x}%, ${point.y}%`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 1;
            const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
            const m = moves[e.key];
            if (m) {
              e.preventDefault();
              onChange({ x: round1(clamp(point.x + m[0])), y: round1(clamp(point.y + m[1])) });
            } else if (e.key === "Home" || e.key === "Escape") {
              e.preventDefault();
              onChange(null);
            }
          }}
          style={{ left: `${point.x}%`, top: `${point.y}%` }}
          className="absolute grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card/90 ring-2 ring-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <LocateFixed className="size-4 text-foreground" aria-hidden />
        </button>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span data-testid={`${testId}-value`} dir="ltr">
          {value ? `${value.x}% / ${value.y}%` : "50% / 50%"}
        </span>
        <Button type="button" variant="outline" size="sm" disabled={!value} onClick={() => onChange(null)} data-testid={`${testId}-reset`}>
          {t("banners.focal.reset")}
        </Button>
      </div>
    </div>
  );
}
