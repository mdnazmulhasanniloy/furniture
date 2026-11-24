"use client";

import { useLocale } from "next-intl";

// Bodoni Moda ships no kerning for capital W/V/Y/T before a lowercase letter, which leaves a visible hole at
// display sizes ("W arm"). Latin headings tighten exactly those pairs by a fixed amount. Arabic is untouched
// (negative spacing breaks its joins). The text stays one continuous string for assistive technology.
const PAIR = /([WVYT])(?=[a-z])/g;
const AMOUNT: Record<string, string> = { W: "-0.07em", V: "-0.05em", Y: "-0.05em", T: "-0.04em" };

export function kernPairs(text: string): (string | { letter: string; key: number })[] {
  const out: (string | { letter: string; key: number })[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(PAIR)) {
    const i = m.index!;
    if (i > last) out.push(text.slice(last, i));
    out.push({ letter: m[1]!, key: key++ });
    last = i + 1;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function KernedText({ children }: { children: string }) {
  const locale = useLocale();
  if (locale === "ar") return <>{children}</>;
  return (
    <>
      {kernPairs(children).map((p, n) =>
        typeof p === "string" ? (
          p
        ) : (
          <span key={n} data-kern={p.letter} style={{ marginInlineEnd: AMOUNT[p.letter] }}>
            {p.letter}
          </span>
        ),
      )}
    </>
  );
}
