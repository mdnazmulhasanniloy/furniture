// @vitest-environment jsdom
// Owner 2026-11-24: one password policy for the API, the storefront and the admin. Here: the shared file is the
// backend's byte for byte, the validator follows it, and the register checklist ticks all five rules live.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
}));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import { PasswordRules } from "@/components/auth/auth-ui";
import { validateNewPassword } from "@/lib/auth/validation";
import { PASSWORD_RULES, failedPasswordRules, isStrongPassword } from "@/lib/password-policy";

const messages = { en, ar } as const;
const OK = "Furnixa#9a";

afterEach(cleanup);

describe("AUTH-03 · password policy, storefront", () => {
  it("AUTH-03 · the shared policy file is identical to the backend's copy, so the two can never disagree", () => {
    const here = fs.readFileSync(path.resolve(__dirname, "../lib/password-policy.ts"), "utf8");
    const api = fs.readFileSync(
      path.resolve(__dirname, "../../../backend/src/lib/passwordPolicy.ts"),
      "utf8",
    );
    expect(here.replace(/\r\n/g, "\n")).toBe(api.replace(/\r\n/g, "\n"));
  });

  it("AUTH-03 · the validator accepts a compliant password and rejects one failure of each rule", () => {
    expect(validateNewPassword(OK)).toBeNull();
    expect(validateNewPassword("")).toBe("required");
    for (const bad of ["Furn#9a", "furnixa#9a", "FURNIXA#9A", "FurnixaPass#", "FurnixaPass9"]) {
      expect(validateNewPassword(bad), bad).toBe("passwordWeak");
      expect(isStrongPassword(bad)).toBe(false);
    }
  });

  for (const locale of ["en", "ar"] as const) {
    it(`AUTH-03 · the checklist shows all five rules and ticks each one as it is met (${locale})`, () => {
      const m = messages[locale];
      const texts = [
        m.auth.rules.length.replace("{n}", "8"),
        m.auth.rules.upper,
        m.auth.rules.lower,
        m.auth.rules.digit,
        m.auth.rules.symbol,
      ];
      // nothing typed yet: five rules, none met
      const { rerender } = render(
        <NextIntlClientProvider locale={locale} messages={m}>
          <PasswordRules value="" />
        </NextIntlClientProvider>,
      );
      const items = () => [...screen.getByTestId("password-rules").querySelectorAll("li")];
      expect(items()).toHaveLength(5);
      expect(items().map((li) => li.getAttribute("data-met"))).toEqual(Array(5).fill("false"));
      for (const text of texts) expect(screen.getByTestId("password-rules").textContent).toContain(text);

      // each rule turns green on its own, while typing
      const steps: [string, string[]][] = [
        ["furnixapass", ["length", "lower"]],
        ["Furnixapass", ["length", "upper", "lower"]],
        ["Furnixapass9", ["length", "upper", "lower", "digit"]],
        [OK, [...PASSWORD_RULES]],
      ];
      for (const [value, met] of steps) {
        rerender(
          <NextIntlClientProvider locale={locale} messages={m}>
            <PasswordRules value={value} />
          </NextIntlClientProvider>,
        );
        const green = items()
          .filter((li) => li.getAttribute("data-met") === "true")
          .map((li, i) => PASSWORD_RULES.filter((_, j) => items()[j]?.getAttribute("data-met") === "true")[i]);
        expect(green.sort(), value).toEqual([...met].sort());
        expect(failedPasswordRules(value).length === 0, value).toBe(met.length === 5);
      }
      expect(items().every((li) => li.getAttribute("data-met") === "true")).toBe(true);
    });
  }

  it("AUTH-03 · the inline error and the API's PASSWORD_TOO_WEAK spell the whole policy, from the approved checklist lines", () => {
    for (const locale of ["en", "ar"] as const) {
      const m = messages[locale];
      const sentence = m.auth.validation.passwordWeak;
      // the client-side message and the server's code map to the same text
      expect(m.errors.PASSWORD_TOO_WEAK).toBe(sentence);
      // and that text is built only from the approved strings: the heading plus all five rules
      expect(sentence.startsWith(m.auth.rules.title)).toBe(true);
      for (const part of [
        m.auth.rules.length.replace("{n}", "8"),
        m.auth.rules.upper,
        m.auth.rules.lower,
        m.auth.rules.digit,
        m.auth.rules.symbol,
      ]) {
        expect(sentence, part).toContain(part);
      }
      // it must differ from the heading alone, which the checklist already shows
      expect(sentence).not.toBe(m.auth.rules.title);
    }
  });
});

describe("AUTH-03 · register blocks submit until every rule is met", () => {
  it("AUTH-03 · a weak password keeps the form unsubmitted and shows the rules", async () => {
    const { RegisterForm } = await import("@/components/auth/register-form");
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <RegisterForm />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(en.auth.firstName), { target: { value: "Sara" } });
    fireEvent.change(screen.getByLabelText(en.auth.lastName), { target: { value: "Alharbi" } });
    fireEvent.change(screen.getByLabelText(en.auth.email), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText(en.auth.password), { target: { value: "FurnixaPass9" } }); // no symbol
    fireEvent.click(screen.getByRole("button", { name: en.auth.register }));
    expect(await screen.findByText(en.auth.errors.summary)).toBeTruthy();
    expect(screen.getByTestId("password-rules").querySelectorAll('li[data-met="false"]')).toHaveLength(1);
  });
});
