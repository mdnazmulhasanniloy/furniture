import { useId } from "react";

/**
 * The web hero arch (ADR-015, design-system section 4), used here ONLY to preview a crop: the admin
 * chrome itself has no arch. Same path as web/src/components/arch.tsx (objectBoundingBox units, symmetric).
 * The web hero shows the image with `object-fit: cover` and `object-position: center` in a 4:5 box,
 * so the middle of the image is what lands inside the arch.
 */
const ARCH_PATH = "M0 1 V0.5 C0 0.22 0.3 0.1 0.5 0 C0.7 0.1 1 0.22 1 0.5 V1 Z";

export function ArchCrop({ src, label, testId }: { src: string; label: string; testId: string }) {
  // useId returns ":r1:"; colons are not valid in a bare url(#...) reference.
  const id = `arch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <figure data-testid={testId} className="w-24 shrink-0">
      <svg width="0" height="0" aria-hidden focusable="false" className="absolute">
        <defs>
          <clipPath id={id} clipPathUnits="objectBoundingBox">
            <path d={ARCH_PATH} />
          </clipPath>
        </defs>
      </svg>
      <div
        data-testid={`${testId}-mask`}
        className="aspect-[4/5] overflow-hidden bg-background"
        style={{ clipPath: `url(#${id})` }}
      >
        <img src={src} alt="" className="size-full object-cover object-center" />
      </div>
      <figcaption className="mt-1 text-center text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
