"use client";

import { motion, type BezierDefinition, type Variants } from "framer-motion";
import { Children, createContext, useContext, useSyncExternalStore } from "react";

import { useMotionPrefs } from "@/lib/use-motion-prefs";

/**
 * The home page's scroll motion, and the only place it is defined (UI-05, ADR-019, CR-012).
 *
 * The grammar is deliberately not configurable: distance, duration, easing, stagger and the trigger margin are
 * the constants below, so no caller can drift from it. That is the whole point - v1 failed because every section
 * had its own reveal. Callers choose only the element, an optional extra delay, and classes.
 *
 * These components wrap content INSIDE the caller's own element rather than replacing it, so `data-testid`,
 * `aria-*` and ids stay exactly where they were.
 *
 * Three rules this file keeps:
 * 1. Only `opacity` and `transform` animate, and only on `y` - never `x`, so nothing has to mirror in RTL
 *    (the one exception is `RevealLine`, which scales on x and flips its origin with a logical class).
 * 2. Children are always in the DOM, and are never taken out of flow or hidden from assistive technology - only
 *    opacity and transform change - so jsdom, Playwright, crawlers and screen readers all see the content
 *    whatever the animation state. (The UI-05 gate test greps this file to keep it that way.)
 * 3. Reduced motion, and a browser without `IntersectionObserver`, are a branch - not a shorter animation.
 *    Both render a plain element in its final state.
 *
 * The hero is never wrapped in these (it holds the LCP image; ADR-019 decision 2), and they are not used
 * outside the home page.
 */

/** px of vertical travel (owner decision Q-3, 2026-11-25). */
const Y = 24;
/** seconds, per item. */
const DURATION = 0.45;
/** ease-out; the item decelerates into place and never overshoots. */
const EASE: BezierDefinition = [0.22, 1, 0.36, 1];
/** Seconds between children of a group. The approved band is 60-80 ms; this is the default. */
const STAGGER = 0.07;
/**
 * Seconds the whole stagger window aims to take. A group of six or fewer staggers at the full 70 ms; longer rows
 * compress towards STAGGER_MIN so the last child does not arrive after the eye has moved on.
 */
const STAGGER_WINDOW = 0.35;
/** The floor, so a compressed group never drops below the approved 60-80 ms band. */
const STAGGER_MIN = 0.06;
/** The block is settled by the time it is comfortably in view, so nothing is read mid-fade. Plays once. */
const VIEWPORT = { once: true, margin: "-10% 0px" } as const;

/**
 * Seconds between children: the full 70 ms for a small group, compressed towards the 60 ms floor for a long row so
 * it does not trickle in. Every value it can return is inside the approved 60-80 ms band.
 * Exported for its own test: this is the one piece of arithmetic here, and it cannot be read off the DOM.
 */
export function staggerSecondsFor(count: number): number {
  if (count < 2) return 0;
  return Math.max(STAGGER_MIN, Math.min(STAGGER, STAGGER_WINDOW / (count - 1)));
}

const HIDDEN = { opacity: 0, y: Y } as const;
const SHOWN = { opacity: 1, y: 0 } as const;

const ITEM: Variants = { hidden: HIDDEN, shown: SHOWN };

/** Elements these wrappers may render. Deliberately short: a wrapper is a box, not a semantic element. */
type Tag = "div" | "section" | "span" | "ul" | "ol" | "li" | "p";

type RevealProps = Readonly<{
  as?: Tag;
  /** Extra seconds before this block starts. For a deliberate second beat, not for building a custom stagger. */
  delay?: number;
  className?: string;
  children: React.ReactNode;
}>;

/** Nothing to subscribe to: whether the browser has an observer cannot change during a page's life. */
const noResubscribe = () => () => {};

/**
 * Whether `whileInView` can ever fire. Read through `useSyncExternalStore` (the same way `useReducedMotion`
 * reads its media query) so the value is available during render without an effect.
 *
 * The server snapshot is `true`: the server renders the hidden first-paint state, which is what lets a block
 * reveal properly instead of flashing in already visible, and the `<noscript>` override covers anyone whose
 * JavaScript never arrives. A real browser missing IntersectionObserver reports `false` on hydration and
 * settles visible - it fails visible, never blank.
 */
function useHasObserver(): boolean {
  return useSyncExternalStore(
    noResubscribe,
    () => typeof IntersectionObserver !== "undefined",
    () => true,
  );
}

/**
 * True when motion must not run at all: the visitor asked for reduced motion, or the browser has no
 * IntersectionObserver (so `whileInView` would never fire and the content would stay invisible).
 */
function useStaticMotion(): boolean {
  // `useMotionPrefs` is the one hook every animation in the storefront reads (it wraps `useReducedMotion` and the
  // writing direction), so reduced motion is never re-implemented here. Its `rtl`/`dir` are not needed: these
  // components move on `y` only, and the one horizontal thing - RevealLine - flips through a logical CSS class,
  // which keeps working with JavaScript off.
  const { reduced } = useMotionPrefs();
  const hasObserver = useHasObserver();
  return reduced || !hasObserver;
}

/** Per-child delay, handed down by RevealGroup so callers never compute a stagger themselves. */
const GroupDelay = createContext(0);

/** One block: fades in and rises once, the first time it is seen. */
export function Reveal({ as = "div", delay = 0, className, children }: RevealProps) {
  const staticOnly = useStaticMotion();
  const Plain = as;
  if (staticOnly) {
    return (
      <Plain className={className} data-motion="static">
        {children}
      </Plain>
    );
  }
  const Moving = motion[as] as React.ElementType;
  return (
    <Moving
      className={className}
      data-motion="reveal"
      initial={HIDDEN}
      whileInView={SHOWN}
      viewport={VIEWPORT}
      transition={{ duration: DURATION, ease: EASE, delay }}
    >
      {children}
    </Moving>
  );
}

/**
 * A group whose children reveal one after another: category tiles, rail cards, the pre-owned steps, the trust
 * facts. The parent itself does not animate (there is nothing to animate on a grid container); it measures the
 * children, works out the stagger and hands each child its own delay, so every child reveals on its own view
 * trigger. That is deliberate: a long rail staggers within the part the visitor can actually see instead of
 * animating cards that are still off screen.
 */
export function RevealGroup({ as = "div", delay = 0, className, children }: RevealProps) {
  const kids = Children.toArray(children);
  const stagger = staggerSecondsFor(kids.length);
  const Plain = as;
  return (
    <Plain className={className} data-motion="reveal-group">
      {kids.map((kid, i) => (
        // The provider renders no element of its own, so a <ul>/<li> or grid stays valid and the layout is untouched.
        <GroupDelay.Provider key={i} value={delay + i * stagger}>
          {kid}
        </GroupDelay.Provider>
      ))}
    </Plain>
  );
}

/** One child of a RevealGroup. Takes its delay from the group; it is the group that decides the rhythm. */
export function RevealItem({ as = "div", className, children }: Omit<RevealProps, "delay">) {
  const staticOnly = useStaticMotion();
  const delay = useContext(GroupDelay);
  const Plain = as;
  if (staticOnly) {
    return (
      <Plain className={className} data-motion="static">
        {children}
      </Plain>
    );
  }
  const Moving = motion[as] as React.ElementType;
  return (
    <Moving
      className={className}
      data-motion="reveal-item"
      initial="hidden"
      whileInView="shown"
      viewport={VIEWPORT}
      variants={ITEM}
      transition={{ duration: DURATION, ease: EASE, delay }}
    >
      {children}
    </Moving>
  );
}

/**
 * The champagne hairline over a pre-owned step or a trust fact, drawn rather than faded (ADR-019 decision 6).
 * It is the one thing here that scales horizontally, so its origin is the inline start edge and flips in RTL.
 * Decorative only: `aria-hidden`, and never a text colour (champagne is 2.2:1 on paper).
 */
export function RevealLine({ className }: Readonly<{ className?: string }>) {
  const staticOnly = useStaticMotion();
  const delay = useContext(GroupDelay);
  const cls = ["block h-0.5 w-full origin-left bg-champagne rtl:origin-right", className].filter(Boolean).join(" ");
  if (staticOnly) {
    return <span aria-hidden className={cls} data-motion="static" />;
  }
  return (
    <motion.span
      aria-hidden
      className={cls}
      data-motion="reveal-line"
      initial={{ scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={VIEWPORT}
      transition={{ duration: 0.4, ease: EASE, delay }}
    />
  );
}

/**
 * Renders once per page that uses any of the above (owner decision Q-6, 2026-11-25).
 *
 * The initial hidden state is an inline style in the server's HTML, which is what lets a block reveal properly
 * instead of flashing in already visible. With JavaScript switched off, nothing would ever clear it - so this
 * <noscript> hands those visitors the final state instead. Browsers apply it only when scripting is off, and
 * it costs about one line of HTML.
 */
export function RevealNoScript() {
  return (
    <noscript>
      <style>{
        '[data-motion="reveal"],[data-motion="reveal-item"]{opacity:1!important;transform:none!important}' +
        '[data-motion="reveal-line"]{transform:none!important}'
      }</style>
    </noscript>
  );
}
