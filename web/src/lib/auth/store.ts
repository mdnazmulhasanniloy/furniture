import { create } from "zustand";

// AUTH-05 / ADR-003: the access token lives in memory only (this store, never
// localStorage/sessionStorage/cookies). The refresh token is the httpOnly `fx_rt`
// cookie, which JavaScript cannot read. The CSRF token (GET /auth/csrf) is bound
// to the session family and survives rotations, so it is cached here too.

export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  phone?: string | null;
  avatarUrl?: string | null;
  isVerified: boolean;
  isBlocked: boolean;
  preferredLocale: "ar" | "en";
};

export type AuthSession = { accessToken: string; user: AuthUser };

export type AuthStatus = "unknown" | "authenticated" | "anonymous";

type AuthState = {
  status: AuthStatus;
  accessToken: string | null;
  csrfToken: string | null;
  user: AuthUser | null;
  setSession: (session: AuthSession) => void;
  setCsrfToken: (token: string | null) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  status: "unknown",
  accessToken: null,
  csrfToken: null,
  user: null,
  setSession: (session) =>
    set({ status: "authenticated", accessToken: session.accessToken, user: session.user }),
  setCsrfToken: (csrfToken) => set({ csrfToken }),
  clear: () => set({ status: "anonymous", accessToken: null, csrfToken: null, user: null }),
}));
