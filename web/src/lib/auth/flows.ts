import { api } from "../api/client";
import { establishSession } from "./session";
import type { AuthSession } from "./store";

// Auth endpoints of api-spec.yaml (AUTH-01, AUTH-03, AUTH-04). All are public:
// skipAuth keeps the client from attaching a token or refreshing on 401.

export type Locale = "ar" | "en";

export type RegisterInput = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  preferredLocale: Locale;
};

export function register(input: RegisterInput) {
  return api.post<{ message: string }>("/auth/register", input, { skipAuth: true });
}

/** Verify the email OTP; on success the user is logged in (token in memory, CSRF primed). */
export async function verifyOtp(email: string, code: string): Promise<AuthSession> {
  const session = await api.post<AuthSession>("/auth/verify-otp", { email, code }, { skipAuth: true });
  await establishSession(session);
  return session;
}

/** VERIFY_EMAIL resend requires the registration password (backend T-027). */
export function resendVerifyOtp(email: string, password: string) {
  return api.post<{ message: string }>(
    "/auth/resend-otp",
    { email, purpose: "VERIFY_EMAIL", password },
    { skipAuth: true },
  );
}

export function forgotPassword(email: string) {
  return api.post<{ message: string }>("/auth/forgot-password", { email }, { skipAuth: true });
}

/** 200 = password changed. It does NOT log the user in (api-spec.yaml). */
export function resetPassword(email: string, code: string, newPassword: string) {
  return api.post<{ message: string }>(
    "/auth/reset-password",
    { email, code, newPassword },
    { skipAuth: true },
  );
}
