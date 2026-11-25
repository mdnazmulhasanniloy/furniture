import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

// T-085 step 4. The photo with its points. The photo is rendered at its natural ratio and the points are
// percentages of *it*, which is exactly how the storefront renders them - so what an admin sees here is
// where the dot will be on every screen (backend T-110 stores the photo's size for that).

export type CanvasPoint = { id: string; x: number; y: number };

const STEP = 1;
const BIG_STEP = 5;
const clamp = (n: number) => Math.min(100, Math.max(0, n));
/** One decimal is plenty for a point on a photo, and keeps the stored config readable. */
const round = (n: number) => Math.round(clamp(n) * 10) / 10;
export const pct = (n: number) => `${round(n)}%`;

export function LookCanvas({
  src,
  alt,
  points,
  selected,
  disabled,
  onSelect,
  onAdd,
  onMove,
  onRemove,
  onPhotoSize,
}: {
  src: string;
  alt: string;
  points: CanvasPoint[];
  selected: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (x: number, y: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onRemove: (id: string) => void;
  onPhotoSize: (size: { width: number; height: number }) => void;
}) {
  const { t } = useTranslation();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; pointerId: number } | null>(null);

  /** Pointer position -> percent of the photo. One path for mouse, pen and touch (Pointer Events). */
  const toPercent = (clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return {
      x: round(((clientX - r.left) / r.width) * 100),
      y: round(((clientY - r.top) / r.height) * 100),
    };
  };

  // While dragging, the pointer may leave the photo (or the window), so the move and up listeners live on
  // the window and are removed as soon as the drag ends.
  useEffect(() => {
    if (disabled) return;
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || (e.pointerId !== undefined && d.pointerId !== e.pointerId))
        return;
      const p = toPercent(e.clientX, e.clientY);
      if (p) onMove(d.id, p.x, p.y);
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  const onKeyDown = (e: React.KeyboardEvent, p: CanvasPoint) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = by[e.key];
    if (d) {
      e.preventDefault();
      onMove(p.id, p.x + d[0], p.y + d[1]);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(p.id);
    }
  };

  return (
    // The border lives on the outer box: the measured element must be *exactly* the photo, or a click
    // would be off by the border width and the point would not land where the storefront draws it.
    <div className="overflow-hidden rounded-lg border border-border bg-muted">
      <div
        ref={box}
        data-testid="look-canvas"
        className={cn("relative select-none", !disabled && "cursor-crosshair")}
        onClick={(e) => {
          if (disabled || e.target !== e.currentTarget) return; // a click on a point is the point's own
          const p = toPercent(e.clientX, e.clientY);
          if (p) onAdd(p.x, p.y);
        }}
      >
        <img
          src={src}
          alt={alt}
          data-testid="look-canvas-image"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0)
              onPhotoSize({
                width: img.naturalWidth,
                height: img.naturalHeight,
              });
          }}
          className="pointer-events-none block h-auto w-full"
        />
        {points.map((p, i) => (
          <button
            key={p.id}
            type="button"
            data-testid="look-point"
            data-id={p.id}
            aria-label={t("sections.looks.editor.pointAt", {
              n: i + 1,
              x: round(p.x),
              y: round(p.y),
            })}
            aria-pressed={selected === p.id}
            disabled={disabled}
            style={{ left: pct(p.x), top: pct(p.y) }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(p.id);
            }}
            onFocus={() => onSelect(p.id)}
            onKeyDown={(e) => onKeyDown(e, p)}
            onPointerDown={(e) => {
              if (disabled) return;
              e.stopPropagation();
              drag.current = { id: p.id, pointerId: e.pointerId };
              e.currentTarget.setPointerCapture?.(e.pointerId);
              onSelect(p.id);
            }}
            className={cn(
              "absolute -ml-4 -mt-4 flex size-8 touch-none items-center justify-center rounded-full bg-background text-xs font-semibold ring-2 ring-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected === p.id && "ring-4 ring-primary",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
