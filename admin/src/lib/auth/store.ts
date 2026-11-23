// ADR-003: the access token lives in memory only (never localStorage/sessionStorage);
// the refresh token is the httpOnly `fx_rt` cookie. The CSRF token (GET /auth/csrf)
// is bound to the session family and survives rotations (ADR-011), so it is cached here.
export type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isVerified: boolean;
  isBlocked: boolean;
  preferredLocale: "ar" | "en";
};
export type AuthSession = { accessToken: string; user: AuthUser };

type State = { accessToken: string | null; csrfToken: string | null; user: AuthUser | null };
let state: State = { accessToken: null, csrfToken: null, user: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const authStore = {
  get: (): State => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setSession(s: AuthSession) {
    state = { ...state, accessToken: s.accessToken, user: s.user };
    emit();
  },
  setCsrfToken(t: string | null) {
    state = { ...state, csrfToken: t };
    emit();
  },
  clear() {
    state = { accessToken: null, csrfToken: null, user: null };
    emit();
  },
};
