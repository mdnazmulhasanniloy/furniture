// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.fn();
const replace = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace }),
  usePathname: () => "/",
}));

import { ForgotForm } from "@/components/auth/forgot-form";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ResetForm } from "@/components/auth/reset-form";
import { VerifyForm } from "@/components/auth/verify-form";
import { configureApiClient } from "@/lib/api/client";
import { usePendingAuth } from "@/lib/auth/pending";
import { useAuthStore } from "@/lib/auth/store";
import { digitsOnly, validateNewPassword } from "@/lib/auth/validation";

const locales = { en, ar } as const;
type Loc = keyof typeof locales;

type Call = { path: string; method: string; body: Record<string, unknown> | null; lang: string | null };
let calls: Call[] = [];
let responder: (path: string, body: Record<string, unknown> | null) => Response;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const err = (status: number, code: string, headers: Record<string, string> = {}) =>
  json(status, { code, message: "English API message" }, headers);
const session = {
  accessToken: "tok",
  user: { id: "1", firstName: "A", lastName: "B", email: "a@b.co", role: "CUSTOMER", isVerified: true,
    isBlocked: false, preferredLocale: "en" as const },
};

beforeEach(() => {
  calls = [];
  push.mockClear();
  replace.mockClear();
  responder = () => json(200, { message: "ok" });
  configureApiClient({
    fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace("/api/v1", "");
      const headers = init?.headers as Record<string, string>;
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ path, method: init?.method ?? "GET", body, lang: headers["Accept-Language"] ?? null });
      if (path === "/auth/csrf") return json(200, { csrfToken: "csrf" });
      return responder(path, body);
    }) as unknown as typeof fetch,
    getLocale: () => "en",
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  configureApiClient(null);
  useAuthStore.getState().clear();
  usePendingAuth.setState({ pending: null, resetEmail: null });
});

function wrap(locale: Loc, ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locales[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const submit = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const paste = (text: string) =>
  fireEvent.paste(screen.getByTestId("otp-0"), { clipboardData: { getData: () => text } });
const tick = (sec: number) => {
  for (let i = 0; i < sec; i++) act(() => vi.advanceTimersByTime(1000));
};
const flush = () => act(async () => {});
const apiCalls = () => calls.filter((c) => c.path !== "/auth/csrf");

describe.each(["en", "ar"] as const)("AUTH-01 · register and verify (%s)", (loc) => {
  const m = locales[loc];

  it(`AUTH-01 · register posts the form with preferredLocale ${loc}, then opens the OTP screen`, async () => {
    wrap(loc, <RegisterForm />);
    type(m.auth.firstName, "Sara");
    type(m.auth.lastName, "Ali");
    type(m.auth.email, " Sara@Example.com ");
    type(m.auth.password, "abc12345");
    submit(m.auth.register);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/verify"));
    expect(apiCalls()[0]).toMatchObject({
      path: "/auth/register",
      body: { firstName: "Sara", lastName: "Ali", email: "sara@example.com", password: "abc12345", preferredLocale: loc },
    });
    expect(usePendingAuth.getState().pending?.email).toBe("sara@example.com");
  });

  it(`AUTH-01 · a weak password is rejected before any request (${loc})`, () => {
    wrap(loc, <RegisterForm />);
    type(m.auth.firstName, "Sara");
    type(m.auth.lastName, "Ali");
    type(m.auth.email, "s@e.co");
    type(m.auth.password, "onlyletters");
    submit(m.auth.register);
    expect(screen.getByText(m.auth.validation.passwordWeak)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it(`AUTH-01 · 409 EMAIL_IN_USE shows the localized message, never the API text (${loc})`, async () => {
    responder = () => err(409, "EMAIL_IN_USE");
    wrap(loc, <RegisterForm />);
    type(m.auth.firstName, "Sara");
    type(m.auth.lastName, "Ali");
    type(m.auth.email, "s@e.co");
    type(m.auth.password, "abc12345");
    submit(m.auth.register);
    expect((await screen.findByRole("alert")).textContent).toBe(m.errors.EMAIL_IN_USE);
    expect(push).not.toHaveBeenCalled();
  });

  it(`AUTH-01 · pasting a code fills the six boxes and verifying logs the user in (${loc})`, async () => {
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    responder = (path) => (path === "/auth/verify-otp" ? json(200, session) : json(200, { message: "ok" }));
    wrap(loc, <VerifyForm />);
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    paste("١٢٣ 456"); // Arabic-Indic digits are normalised
    expect((screen.getByTestId("otp-5") as HTMLInputElement).value).toBe("6");
    submit(m.auth.verifySubmit);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(apiCalls()[0]).toMatchObject({ path: "/auth/verify-otp", body: { email: "s@e.co", code: "123456" } });
    expect(useAuthStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("tok");
    expect(usePendingAuth.getState().pending).toBeNull();
  });

  it(`AUTH-01 · a wrong code shows the localized error and keeps the screen (${loc})`, async () => {
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    responder = () => err(400, "OTP_INVALID");
    wrap(loc, <VerifyForm />);
    paste("111111");
    submit(m.auth.verifySubmit);
    expect((await screen.findByRole("alert")).textContent).toBe(m.errors.OTP_INVALID);
    expect(replace).not.toHaveBeenCalled();
  });

  it(`AUTH-01 · incomplete code is not sent (${loc})`, () => {
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    wrap(loc, <VerifyForm />);
    paste("123");
    submit(m.auth.verifySubmit);
    expect(screen.getByText(m.auth.validation.codeIncomplete)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it(`AUTH-01 · OTP_EXPIRED re-submits the register request from memory, says a new code was sent and resets the countdown (${loc})`, async () => {
    vi.useFakeTimers();
    usePendingAuth.getState().setPending({
      email: "s@e.co", password: "abc12345", firstName: "Sara", lastName: "Ali",
    });
    responder = (path) => (path === "/auth/verify-otp" ? err(400, "OTP_EXPIRED") : json(201, { message: "ok" }));
    wrap(loc, <VerifyForm />);
    tick(45);
    paste("123456");
    submit(m.auth.verifySubmit);
    await flush();
    await flush();
    const paths = apiCalls().map((c) => c.path);
    expect(paths).toEqual(["/auth/verify-otp", "/auth/register"]);
    expect(apiCalls()[1].body).toMatchObject({
      firstName: "Sara", lastName: "Ali", email: "s@e.co", password: "abc12345", preferredLocale: loc,
    });
    expect(screen.getByText(m.auth.newCodeSent)).toBeTruthy();
    expect(screen.getByTestId("resend-countdown").textContent).toContain("60");
    // never persisted in the browser
    expect(JSON.stringify({ ...localStorage })).not.toContain("abc12345");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("abc12345");
  });

  it(`AUTH-01 · OTP_EXPIRED without register data asks to start again (${loc})`, async () => {
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    responder = () => err(400, "OTP_EXPIRED");
    wrap(loc, <VerifyForm />);
    paste("123456");
    submit(m.auth.verifySubmit);
    expect((await screen.findByText(new RegExp(m.auth.expiredStartOver.slice(0, 12)))).textContent).toContain(
      m.auth.register,
    );
    expect(apiCalls().map((c) => c.path)).toEqual(["/auth/verify-otp"]);
  });
});

describe.each(["en", "ar"] as const)("AUTH-02 · login (%s)", (loc) => {
  const m = locales[loc];

  it(`AUTH-02 · correct credentials log in and go home (${loc})`, async () => {
    responder = () => json(200, session);
    wrap(loc, <LoginForm />);
    type(m.auth.email, "A@B.co");
    type(m.auth.password, "secret123");
    submit(m.auth.login);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(apiCalls()[0]).toMatchObject({ path: "/auth/login", body: { email: "a@b.co", password: "secret123" } });
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it(`AUTH-02 · an unverified account is redirected to the verify screen (${loc})`, async () => {
    responder = () => err(403, "EMAIL_NOT_VERIFIED");
    wrap(loc, <LoginForm />);
    type(m.auth.email, "a@b.co");
    type(m.auth.password, "secret123");
    submit(m.auth.login);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/verify"));
    expect(usePendingAuth.getState().pending).toEqual({ email: "a@b.co", password: "secret123" });
    expect(useAuthStore.getState().status).not.toBe("authenticated");
  });

  it(`AUTH-02 · wrong credentials show the localized error (${loc})`, async () => {
    responder = () => err(401, "INVALID_CREDENTIALS");
    wrap(loc, <LoginForm />);
    type(m.auth.email, "a@b.co");
    type(m.auth.password, "nope");
    submit(m.auth.login);
    expect((await screen.findByRole("alert")).textContent).toBe(m.errors.INVALID_CREDENTIALS);
  });

  it(`AUTH-02 · a locked account shows the Retry-After wait, a blocked one its own message (${loc})`, async () => {
    responder = () => err(429, "ACCOUNT_LOCKED", { "Retry-After": "600" });
    wrap(loc, <LoginForm />);
    type(m.auth.email, "a@b.co");
    type(m.auth.password, "nope");
    submit(m.auth.login);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.startsWith(m.errors.ACCOUNT_LOCKED)).toBe(true);
    expect(alert.textContent).toMatch(/10|١٠|عشر/);
    cleanup();
    responder = () => err(403, "ACCOUNT_BLOCKED");
    wrap(loc, <LoginForm />);
    type(m.auth.email, "a@b.co");
    type(m.auth.password, "x");
    submit(m.auth.login);
    expect((await screen.findByRole("alert")).textContent).toBe(m.errors.ACCOUNT_BLOCKED);
  });

  it(`AUTH-02 · the post-reset notice shows on the login screen (${loc})`, () => {
    wrap(loc, <LoginForm resetDone />);
    expect(screen.getByRole("status").textContent).toBe(m.auth.resetDone);
  });
});

describe.each(["en", "ar"] as const)("AUTH-03 · forgot and reset (%s)", (loc) => {
  const m = locales[loc];

  it(`AUTH-03 · forgot-password always moves on to the reset screen (${loc})`, async () => {
    wrap(loc, <ForgotForm />);
    type(m.auth.email, "Nobody@Example.com");
    submit(m.auth.sendCode);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reset-password"));
    expect(apiCalls()[0]).toMatchObject({ path: "/auth/forgot-password", body: { email: "nobody@example.com" } });
    expect(usePendingAuth.getState().resetEmail).toBe("nobody@example.com");
  });

  it(`AUTH-03 · success is NOT a login: it sends the user to the login screen (${loc})`, async () => {
    usePendingAuth.getState().setResetEmail("a@b.co");
    wrap(loc, <ResetForm />);
    paste("654321");
    type(m.auth.newPassword, "newpass123");
    submit(m.auth.resetSubmit);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reset=1"));
    expect(apiCalls()[0]).toMatchObject({
      path: "/auth/reset-password",
      body: { email: "a@b.co", code: "654321", newPassword: "newpass123" },
    });
    expect(useAuthStore.getState().status).not.toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it(`AUTH-03 · OTP_INVALID shows "invalid or expired code" with a link to request a new one (${loc})`, async () => {
    usePendingAuth.getState().setResetEmail("a@b.co");
    responder = () => err(400, "OTP_INVALID");
    wrap(loc, <ResetForm />);
    paste("000000");
    type(m.auth.newPassword, "newpass123");
    submit(m.auth.resetSubmit);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(m.auth.codeInvalidReset);
    expect(screen.getByRole("link", { name: m.auth.requestNewCode }).getAttribute("href")).toBe("/forgot-password");
    expect(replace).not.toHaveBeenCalled();
  });

  it(`AUTH-03 · RATE_LIMITED shows the Retry-After wait (${loc})`, async () => {
    usePendingAuth.getState().setResetEmail("a@b.co");
    responder = () => err(429, "RATE_LIMITED", { "Retry-After": "30" });
    wrap(loc, <ResetForm />);
    paste("000000");
    type(m.auth.newPassword, "newpass123");
    submit(m.auth.resetSubmit);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent?.startsWith(m.errors.RATE_LIMITED)).toBe(true);
    expect(alert.textContent).toMatch(/30|٣٠/);
  });

  it(`AUTH-03 · a weak new password is rejected locally (${loc})`, () => {
    usePendingAuth.getState().setResetEmail("a@b.co");
    wrap(loc, <ResetForm />);
    paste("123456");
    type(m.auth.newPassword, "short1");
    submit(m.auth.resetSubmit);
    expect(screen.getByText(m.auth.validation.passwordWeak)).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});

describe.each(["en", "ar"] as const)("AUTH-04 · resend countdown (%s)", (loc) => {
  const m = locales[loc];
  const resendIn = (s: number) => m.auth.resendIn.replace("{seconds}", String(s));

  it(`AUTH-04 · resend is disabled for 60 s with a countdown, then sends {email, purpose, password} (${loc})`, async () => {
    vi.useFakeTimers();
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    wrap(loc, <VerifyForm />);
    expect(screen.getByTestId("resend-countdown").textContent).toContain("60");
    expect(screen.queryByRole("button", { name: m.auth.resend })).toBeNull();
    tick(10);
    expect(screen.getByTestId("resend-countdown").textContent).toContain("50");
    tick(50);
    fireEvent.click(screen.getByRole("button", { name: m.auth.resend }));
    await flush();
    expect(apiCalls()[0]).toMatchObject({
      path: "/auth/resend-otp",
      body: { email: "s@e.co", purpose: "VERIFY_EMAIL", password: "abc12345" },
    });
    expect(screen.getByText(m.auth.codeSentAgain)).toBeTruthy();
    expect(screen.getByTestId("resend-countdown").textContent).toContain("60");
    void resendIn;
  });

  it(`AUTH-04 · a 429 on resend shows the wait and restarts the countdown from Retry-After (${loc})`, async () => {
    vi.useFakeTimers();
    usePendingAuth.getState().setPending({ email: "s@e.co", password: "abc12345" });
    responder = () => err(429, "RATE_LIMITED", { "Retry-After": "25" });
    wrap(loc, <VerifyForm />);
    tick(60);
    fireEvent.click(screen.getByRole("button", { name: m.auth.resend }));
    await flush();
    expect(screen.getByRole("alert").textContent?.startsWith(m.errors.RATE_LIMITED)).toBe(true);
    expect(screen.getByTestId("resend-countdown").textContent).toContain("25");
  });

  it(`AUTH-04 · without in-memory registration the verify screen sends the user back to register (${loc})`, () => {
    wrap(loc, <VerifyForm />);
    expect(replace).toHaveBeenCalledWith("/register");
  });
});

describe("AUTH-01 · validation helpers", () => {
  it("AUTH-01 · password rule matches the API (8-128, a letter and a number)", () => {
    expect(validateNewPassword("abc12345")).toBeNull();
    expect(validateNewPassword("abcdefgh")).toBe("passwordWeak");
    expect(validateNewPassword("12345678")).toBe("passwordWeak");
    expect(validateNewPassword("a1")).toBe("passwordWeak");
    expect(validateNewPassword("a1" + "x".repeat(127))).toBe("passwordWeak");
  });
  it("AUTH-04 · digitsOnly maps Arabic-Indic digits and drops the rest", () => {
    expect(digitsOnly("١٢٣-۴۵۶ x")).toBe("123456");
  });
});
