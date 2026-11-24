import { cn } from "@/lib/utils";

/**
 * The Najdi arch (ADR-015): the one signature shape, used for the hero image, the category tiles and the
 * auth image panel, nowhere else. A pointed arch: straight sides, shoulders that rise to a soft point.
 * The path is symmetric (objectBoundingBox units), so it needs no mirroring in RTL.
 */
export const ARCH_PATH = "M0 1 V0.5 C0 0.22 0.3 0.1 0.5 0 C0.7 0.1 1 0.22 1 0.5 V1 Z";

/** Mount once in the layout: defines the clipPath that `.arch` (globals.css) points at. */
export function ArchDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" className="absolute">
      <defs>
        <clipPath id="fx-arch" clipPathUnits="objectBoundingBox">
          <path d={ARCH_PATH} />
        </clipPath>
      </defs>
    </svg>
  );
}

/**
 * Arch frame. `ratio` is the aspect ratio (4/5 hero, 3/4 tiles). `outline` draws the thin date-gold arch
 * behind the image, offset up and toward the page edge (logical offsets, so it mirrors in RTL).
 */
export function Arch({
  children,
  ratio = "4/5",
  outline = false,
  className,
}: {
  children?: React.ReactNode;
  ratio?: "4/5" | "3/4";
  outline?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid="arch"
      className={cn("relative", ratio === "4/5" ? "aspect-[4/5]" : "aspect-[3/4]", className)}
    >
      {outline ? (
        <svg
          data-testid="arch-outline"
          data-arch-outline
          aria-hidden
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="pointer-events-none absolute -top-3.5 -end-3.5 size-full overflow-visible"
        >
          <path d={ARCH_PATH} fill="none" stroke="var(--gold)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}
      <div className="arch absolute inset-0 overflow-hidden bg-muted">{children}</div>
    </div>
  );
}
