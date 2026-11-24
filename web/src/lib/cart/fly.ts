import { animate } from "framer-motion";

/**
 * Fly-to-cart (W-03): a small token travels from the Add button to the header cart icon.
 * Decorative only: skipped under prefers-reduced-motion or when either element is missing.
 */
export function flyToCart(from: Element | null): void {
  try {
    if (typeof window === "undefined" || !from) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const target = document.querySelector('[data-testid="cart-link"]');
    if (!target) return;
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const dot = document.createElement("div");
    dot.setAttribute("aria-hidden", "true");
    dot.setAttribute("data-testid", "fly-dot");
    dot.className = "pointer-events-none fixed z-[60] size-4 rounded-full bg-primary";
    dot.style.left = `${a.left + a.width / 2 - 8}px`;
    dot.style.top = `${a.top + a.height / 2 - 8}px`;
    document.body.appendChild(dot);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const done = () => dot.remove();
    animate(dot, { x: [0, dx], y: [0, dy], scale: [1, 0.4], opacity: [1, 0.2] }, { duration: 0.6, ease: "easeInOut" }).then(
      done,
      done,
    );
    setTimeout(done, 1500);
  } catch {
    /* decoration must never break adding to cart */
  }
}
