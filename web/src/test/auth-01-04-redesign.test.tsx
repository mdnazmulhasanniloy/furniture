// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
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

import { LoginForm } from "@/components/auth/login-form";
import { OtpInput } from "@/components/auth/otp-input";
import { RegisterForm } from "@/components/auth/register-form";

const locales = { en, ar } as const;
type Loc = keyof typeof locales;
afterEach(() => {
  cleanup();
  // @ts-expect-error jsdom has no matchMedia; remove the stub
  delete window.matchMedia;
});
const wrap = (locale: Loc, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

describe.each(["en", "ar"] as const)("AUTH-01 · redesigned auth screens (%s)", (locale) => {
  const m = locales[locale];

  it(`AUTH-01 · split layout: wordmark, image placeholder panel and a gold accent line on the emerald caption (${locale})`, () => {
    wrap(locale, <LoginForm />);
    expect(screen.getByTestId("auth-shell").className).toContain("lg:grid-cols-2");
    expect(screen.getAllByTestId("wordmark")[0]!.textContent).toBe(m.home.brand);
    const panel = screen.getByTestId("auth-panel");
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.querySelector('[data-testid="image-placeholder"]')).not.toBeNull();
    expect(screen.getByTestId("auth-accent").className).toContain("bg-gold");
    expect(panel.textContent).toContain(m.auth.panelTitle);
  });

  it(`AUTH-01 · login validates inline on blur and clears the error once fixed (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const email = screen.getByLabelText(m.auth.email);
    fireEvent.blur(email); // empty
    expect(screen.getByText(m.auth.validation.required)).toBeTruthy();
    fireEvent.change(email, { target: { value: "a@b.co" } });
    expect(screen.queryByText(m.auth.validation.required)).toBeNull();
    expect(email.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(email, { target: { value: "nope" } });
    fireEvent.blur(email);
    expect(screen.getByText(m.auth.validation.emailInvalid)).toBeTruthy();
  });

  it(`AUTH-01 · register validates each field inline on blur (${locale})`, () => {
    wrap(locale, <RegisterForm />);
    fireEvent.blur(screen.getByLabelText(m.auth.firstName));
    fireEvent.change(screen.getByLabelText(m.auth.password), { target: { value: "short" } });
    fireEvent.blur(screen.getByLabelText(m.auth.password));
    expect(screen.getByText(m.auth.validation.required)).toBeTruthy();
    expect(screen.getByText(m.auth.validation.passwordWeak)).toBeTruthy();
    // Only the touched fields complain.
    expect(screen.getAllByText(m.auth.validation.required)).toHaveLength(1);
  });
});

describe.each(["en", "ar"] as const)("AUTH-01 · animated OTP boxes (%s)", (locale) => {
  function Harness({ invalid = false, start = "" }: { invalid?: boolean; start?: string }) {
    const [v, setV] = useState(start);
    return (
      <OtpInput value={v} onChange={setV} invalid={invalid} groupLabel="code" label={(n) => `digit ${n}`} />
    );
  }

  it(`AUTH-01 · six boxes, filled boxes are marked and the group stays left-to-right (${locale})`, () => {
    wrap(locale, <Harness start="12" />);
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`otp-${i}`)).toBeTruthy();
    expect(screen.getByTestId("otp-0").getAttribute("data-filled")).toBe("true");
    expect(screen.getByTestId("otp-1").getAttribute("data-filled")).toBe("true");
    expect(screen.getByTestId("otp-2").getAttribute("data-filled")).toBe("false");
    expect(screen.getByTestId("otp-group").getAttribute("dir")).toBe("ltr");
  });

  it(`AUTH-01 · typing and pasting still fill the boxes, Arabic-Indic digits included (${locale})`, () => {
    wrap(locale, <Harness />);
    fireEvent.change(screen.getByTestId("otp-0"), { target: { value: "٤" } });
    expect((screen.getByTestId("otp-0") as HTMLInputElement).value).toBe("4");
    fireEvent.paste(screen.getByTestId("otp-0"), { clipboardData: { getData: () => "123 456" } });
    expect((screen.getByTestId("otp-5") as HTMLInputElement).value).toBe("6");
  });

  it(`AUTH-01 · reduced motion: no pop or shake animation values (${locale})`, () => {
    window.matchMedia = ((q: string) =>
      ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList) as typeof window.matchMedia;
    wrap(locale, <Harness invalid start="1" />);
    const group = screen.getByTestId("otp-group");
    expect(group.style.transform === "" || group.style.transform === "none").toBe(true);
  });

  it(`AUTH-01 · an invalid code marks every box invalid (${locale})`, () => {
    wrap(locale, <Harness invalid start="123456" />);
    for (let i = 0; i < 6; i++) expect(screen.getByTestId(`otp-${i}`).getAttribute("aria-invalid")).toBe("true");
  });
});
