// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/navigation", () => ({ useParams: () => ({}) }));

import { SiteHeader } from "@/components/layout/site-header";

const locales = { en, ar } as const;
afterEach(cleanup);

describe.each(["en", "ar"] as const)("UI-02 · dialog keyboard behaviour (%s)", (locale) => {
  const m = locales[locale];
  const open = () => {
    render(
      <NextIntlClientProvider locale={locale} messages={m}>
        <SiteHeader categories={[]} />
      </NextIntlClientProvider>,
    );
    const trigger = screen.getByTestId("mobile-nav-trigger");
    trigger.focus();
    fireEvent.click(trigger);
    return trigger;
  };

  it(`UI-02 · mobile nav moves focus inside and traps Tab (${locale})`, () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>("a[href], button, input"));
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it(`UI-02 · Escape closes the mobile nav and returns focus to the trigger (${locale})`, () => {
    const trigger = open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it(`UI-02 · skip link text exists (${locale})`, () => {
    expect(m.nav.skip.length).toBeGreaterThan(0);
  });
});

describe("UI-01 · reduced motion and focus styles", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("UI-01 · prefers-reduced-motion disables animation and transitions globally", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.01ms/);
    expect(css).toMatch(/transition-duration: 0\.01ms/);
  });

  it("UI-02 · a global :focus-visible ring uses the --ring token", () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*var\(--ring\)/);
  });
});
