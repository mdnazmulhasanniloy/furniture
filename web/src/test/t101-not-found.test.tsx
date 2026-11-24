// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({ locale: "en" as "en" | "ar" }));
const messages = { en, ar } as const;
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: state.locale, messages: messages[state.locale], namespace: ns as never }),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import NotFound from "@/app/[locale]/not-found";

afterEach(cleanup);

describe.each(["en", "ar"] as const)("UI-04 · 404 page (%s)", (locale) => {
  it(`UI-04 · a styled 404 with a title, a sentence and two ways out (${locale})`, async () => {
    state.locale = locale;
    render(await NotFound());
    const m = messages[locale];
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(m.pages.notFound.title);
    expect(screen.getByText(m.pages.notFound.body)).toBeTruthy();
    const links = screen.getAllByRole("link");
    expect(links.map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      ["/", m.pages.notFound.home],
      ["/shop", m.nav.shop],
    ]);
    expect(screen.getByTestId("not-found").innerHTML).toContain("bg-blush");
  });
});
