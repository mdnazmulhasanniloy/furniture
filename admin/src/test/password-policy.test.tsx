import { act, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";

import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { PASSWORD_RULES, isStrongPassword } from "@/lib/password-policy";
import { ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

// Owner 2026-11-24: the admin uses the same password policy and the same live checklist as the API and the storefront.

const messages = { en, ar } as const;

async function mount(locale: Locale) {
  const i18n = initI18n(locale);
  await setLocale(locale); // the harness order matters: init first, then switch
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/accept-invite?email=new%40furnixa.test"]}>
          <App />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

let calls: string[] = [];
function stubApi() {
  calls = [];
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      calls.push(path);
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ code: "UNAUTHORIZED" }, 401); // anonymous, no retry loop
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  authStore.clear();
  window.localStorage.clear();
  stubApi();
});

describe("AUTH-03 · password policy, admin", () => {
  it("AUTH-03 · the shared policy file is identical to the backend's copy, so the two can never disagree", () => {
    const here = fs.readFileSync(path.resolve(__dirname, "../lib/password-policy.ts"), "utf8");
    const api = fs.readFileSync(
      path.resolve(__dirname, "../../../backend/src/lib/passwordPolicy.ts"),
      "utf8",
    );
    expect(here.replace(/\r\n/g, "\n")).toBe(api.replace(/\r\n/g, "\n"));
  });

  it("AUTH-03 · the policy accepts a compliant password and rejects one failure of each rule", () => {
    expect(isStrongPassword("Furnixa#9a")).toBe(true);
    for (const bad of ["Furn#9a", "furnixa#9a", "FURNIXA#9A", "FurnixaPass#", "FurnixaPass9"]) {
      expect(isStrongPassword(bad), bad).toBe(false);
    }
  });

  for (const locale of ["en", "ar"] as const) {
    it(`AUTH-03 · the invite screen shows the five live rules and ticks each as it is met (${locale})`, async () => {
      const m = messages[locale];
      await mount(locale);
      // The invite page is loaded on demand since QA C4.
      const field = await screen.findByLabelText(m.auth.newPassword);
      const rules = screen.getByTestId("password-rules");
      const met = () =>
        [...rules.querySelectorAll("li")].map((li) => li.getAttribute("data-met") === "true");
      expect(rules.querySelectorAll("li")).toHaveLength(5);
      expect([...rules.querySelectorAll("li")].map((li) => li.getAttribute("data-rule"))).toEqual([
        ...PASSWORD_RULES,
      ]);
      expect(rules.textContent).toContain(m.auth.rules.title);
      expect(rules.textContent).toContain(m.auth.rules.symbol);
      expect(met()).toEqual([false, false, false, false, false]);

      const type = async (value: string) => {
        await act(async () => {
          fireEvent.change(field, { target: { value } });
        });
      };
      await type("abcdefgh");
      expect(met()).toEqual([true, false, true, false, false]);
      await type("Abcdefgh");
      expect(met()).toEqual([true, true, true, false, false]);
      await type("Abcdefg1");
      expect(met()).toEqual([true, true, true, true, false]);
      await type("Abcdefg1!");
      expect(met()).toEqual([true, true, true, true, true]);
      await type("Ab1!");
      expect(met()).toEqual([false, true, true, true, true]); // only the length is missing
    });

    it(`AUTH-03 · a password that breaks the policy is refused locally, with the policy spelled out (${locale})`, async () => {
      const m = messages[locale];
      await mount(locale);
      await screen.findByLabelText(m.auth.code); // loaded on demand since QA C4
      await act(async () => {
        fireEvent.change(screen.getByLabelText(m.auth.code), { target: { value: "123456" } });
        fireEvent.change(screen.getByLabelText(m.auth.newPassword), {
          target: { value: "FurnixaPass9" }, // no special character
        });
      });
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
      expect(screen.getAllByRole("alert").map((a) => a.textContent)).toContain(m.auth.passwordWeak);
      expect(calls).not.toContain("/auth/accept-invite"); // refused before any request
      // the sentence is built from the approved checklist lines, and the API's code maps to the same text
      expect(m.auth.passwordWeak.startsWith(m.auth.rules.title)).toBe(true);
      expect(m.errors.PASSWORD_TOO_WEAK).toBe(m.auth.passwordWeak);
    });
  }
});
