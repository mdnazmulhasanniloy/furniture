// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

import { SiteFactsProvider } from "@/lib/site-facts";
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

  it(`UI-04 · auth split: a photo panel with the wordmark and the one true brand line, the form beside it, no arch (${locale})`, () => {
    wrap(locale, <SiteFactsProvider cityCount={6}><LoginForm /></SiteFactsProvider>);
    expect(screen.getByTestId("auth-shell").className).toContain("lg:grid-cols-2");
    const panel = screen.getByTestId("auth-panel");
    const shell = screen.getByTestId("auth-shell");
    expect(shell.firstElementChild).toBe(panel); // photo on the inline-start side: mirrors in RTL
    expect(panel.className).toContain("h-[28vh]"); // mobile banner
    expect(panel.className).toContain("lg:h-auto");
    expect(within(panel).getByTestId("wordmark")).toBeTruthy();
    // the only claim is cash on delivery in the NUMBER of active cities, never the whole country
    expect(screen.getByTestId("brand-line").textContent).toBe(locale === "en" ? "Cash on delivery in 6 Saudi cities." : "الدفع نقدًا عند التسليم في 6 مدن سعودية.");
    expect(panel.textContent).not.toMatch(/across Saudi|all cities|أنحاء|جميع مدن|كل مدن/);
    expect(panel.querySelector("img")?.getAttribute("src")).toContain("auth.jpg");
    expect(screen.queryByTestId("arch")).toBeNull();
    expect(screen.queryByTestId("auth-arch-small")).toBeNull();
    expect(shell.innerHTML).toContain("max-w-[440px]");
  });

  it(`UI-04 · the brand line follows the active city count and is hidden without one (${locale})`, () => {
    const { unmount } = wrap(locale, <SiteFactsProvider cityCount={1}><LoginForm /></SiteFactsProvider>);
    expect(screen.getByTestId("brand-line").textContent).toBe(locale === "en" ? "Cash on delivery in 1 Saudi city." : "الدفع نقدًا عند التسليم في مدينة سعودية واحدة.");
    unmount();
    const two = wrap(locale, <SiteFactsProvider cityCount={2}><LoginForm /></SiteFactsProvider>);
    expect(screen.getByTestId("brand-line").textContent).toBe(locale === "en" ? "Cash on delivery in 2 Saudi cities." : "الدفع نقدًا عند التسليم في مدينتين سعوديتين.");
    two.unmount();
    wrap(locale, <LoginForm />); // settings unavailable: no count, no claim
    expect(screen.queryByTestId("brand-line")).toBeNull();
  });

  it(`UI-04 · auth v3: floating-label 56 px fields, a 48 px full-width submit, flat alerts (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const email = screen.getByLabelText(m.auth.email);
    expect(email.className).toContain("h-14");
    expect(email.className).toContain("rounded-sm");
    expect(email.className).toContain("border-input");
    expect(email.getAttribute("placeholder")).toBe(" "); // the label floats via :placeholder-shown
    expect(email.className).toContain("peer");
    const label = document.querySelector(`label[for="${email.id}"]`)!;
    expect(label.className).toContain("peer-focus:text-xs");
    const submit = screen.getByRole("button", { name: m.auth.login });
    expect(submit.className).toContain("h-12");
    expect(submit.className).toContain("w-full");
    expect(screen.getByRole("heading", { level: 1 }).className).toContain("text-4xl");
  });

  it(`UI-04 · the password field has a show/hide toggle (${locale})`, () => {
    wrap(locale, <LoginForm />);
    const input = screen.getByLabelText(m.auth.password) as HTMLInputElement;
    expect(input.type).toBe("password");
    const show = screen.getByRole("button", { name: m.auth.field.show });
    expect(show.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(show);
    expect(input.type).toBe("text");
    const hide = screen.getByRole("button", { name: m.auth.field.hide });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(input.type).toBe("password");
  });

  it(`UI-04 · register shows live password rules that match the API: 8 or more, a letter, a number (${locale})`, () => {
    wrap(locale, <RegisterForm />);
    const rules = screen.getByTestId("password-rules");
    const met = () => [...rules.querySelectorAll("li")].map((li) => li.getAttribute("data-met"));
    expect(rules.textContent).toContain(m.auth.rules.title);
    expect(met()).toEqual(["false", "false", "false"]);
    const input = screen.getByLabelText(m.auth.password);
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(met()).toEqual(["true", "true", "false"]);
    fireEvent.change(input, { target: { value: "abc1" } });
    expect(met()).toEqual(["false", "true", "true"]);
    fireEvent.change(input, { target: { value: "abcdefg1" } });
    expect(met()).toEqual(["true", "true", "true"]);
    expect(input.getAttribute("aria-describedby")).toContain(rules.parentElement!.id);
  });

  it(`UI-04 · a failed submit shows the summary, marks the fields and moves focus to the first invalid one (${locale})`, async () => {
    vi.useFakeTimers();
    wrap(locale, <RegisterForm />);
    fireEvent.click(screen.getByRole("button", { name: m.auth.register }));
    expect(screen.getByRole("alert").textContent).toBe(m.auth.errors.summary);
    expect(screen.getByLabelText(m.auth.firstName).getAttribute("aria-invalid")).toBe("true");
    act(() => void vi.advanceTimersByTime(10));
    expect(document.activeElement).toBe(screen.getByLabelText(m.auth.firstName));
    vi.useRealTimers();
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
