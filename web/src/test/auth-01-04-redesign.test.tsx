// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

  it(`UI-01 · auth v2: form on the start side, the third arch on a sand panel on the end side with a gold outline (${locale})`, () => {
    wrap(locale, <LoginForm />);
    expect(screen.getByTestId("auth-shell").className).toContain("lg:grid-cols-2");
    // the header already carries the wordmark: the form side repeats nothing but the placeholder's own mark
    expect(screen.getAllByTestId("wordmark")).toHaveLength(1);
    const panel = screen.getByTestId("auth-panel");
    expect(panel.getAttribute("aria-hidden")).toBe("true");
    expect(panel.className).toContain("bg-muted");
    expect(panel.className).toContain("hidden");
    const arch = within(panel).getByTestId("arch");
    expect(arch.className).toContain("aspect-[4/5]");
    expect(within(panel).getByTestId("arch-outline")).toBeTruthy();
    expect(panel.querySelector('[data-testid="image-placeholder"]')).not.toBeNull();
    expect(panel.textContent).toContain(m.auth.panelTitle);
  });

  it(`UI-01 · auth v2: the caption is plain text, no emerald slab and no gold accent line (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const panel = screen.getByTestId("auth-panel");
    expect(screen.queryByTestId("auth-accent")).toBeNull();
    expect(panel.innerHTML).not.toMatch(/bg-primary|bg-gold|rounded-xl/);
  });

  it(`UI-01 · auth v2: on mobile a small 3:4 arch sits above the title and is hidden from lg up (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const small = screen.getByTestId("auth-arch-small");
    expect(small.className).toContain("lg:hidden");
    expect(small.getAttribute("aria-hidden")).toBe("true");
    expect(within(small).getByTestId("arch").className).toContain("aspect-[3/4]");
    expect(within(small).queryByTestId("arch-outline")).toBeNull();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(small.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it(`UI-01 · auth v2: arch used exactly twice on the page (panel and small mobile), never on the form (${locale})`, () => {
    wrap(locale, <LoginForm />);
    expect(screen.getAllByTestId("arch")).toHaveLength(2);
    expect(document.querySelector("form")).not.toBeNull();
    expect(document.querySelector("form [data-testid=arch]")).toBeNull();
  });

  it(`UI-01 · auth v2: 44 px fields with the sm radius, a 48 px full-width submit, flat alerts (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const email = screen.getByLabelText(m.auth.email);
    expect(email.className).toContain("h-11");
    expect(email.className).toContain("rounded-sm");
    expect(email.className).toContain("border-input");
    const submit = screen.getByRole("button", { name: m.auth.login });
    expect(submit.className).toContain("h-12");
    expect(submit.className).toContain("w-full");
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-4xl");
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
    // v2: tall boxes with the sm radius; a filled box gets the emerald 1.5 px border
    const first = screen.getByTestId("otp-0");
    expect(first.className).toContain("h-14");
    expect(first.className).toContain("rounded-sm");
    expect(first.className).toContain("data-[filled=true]:border-primary");
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
