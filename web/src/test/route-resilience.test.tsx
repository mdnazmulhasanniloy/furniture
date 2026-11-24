// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import RouteError from "@/app/[locale]/error";
import { getCategories, getPage, getProduct, getSettings } from "@/lib/api/public";

const messages = { en, ar } as const;
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(["en", "ar"] as const)("UI-04 · a render error never leaves a blank page (%s)", (locale) => {
  it(`UI-04 · the route error boundary shows the generic message and a retry button (${locale})`, () => {
    const reset = vi.fn();
    render(
      <NextIntlClientProvider locale={locale} messages={messages[locale]}>
        <RouteError error={new Error("boom")} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(messages[locale].errors.generic);
    fireEvent.click(screen.getByRole("button", { name: messages[locale].cart.retry }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("UI-04 · server fetches to the API time out, so a hung API cannot hold the page", () => {
  it("UI-04 · every public fetch carries an abort signal", async () => {
    const fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await getCategories();
    await getSettings();
    await getProduct("x");
    await getPage("x");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("UI-04 · a timeout degrades to the fallback value instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("timed out", "TimeoutError"))));
    expect(await getCategories()).toEqual([]);
    expect(await getSettings()).toBeNull();
    expect(await getProduct("x")).toEqual({ status: "error" });
    expect(await getPage("x")).toEqual({ status: "error" });
  });
});
