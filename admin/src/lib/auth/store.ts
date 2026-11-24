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

// `status`: "unknown" until the first refresh-cookie restore attempt finishes (route guards wait).
export type AuthStatus = "unknown" | "authenticated" | "anonymous";
type State = {
  accessToken: string | null;
  csrfToken: string | null;
  user: AuthUser | null;
  status: AuthStatus;
  /**
   * Bumped whenever the session identity changes (sign-in, sign-out). A refresh that was already in
   * flight compares it and drops its result instead of resurrecting a session that ended meanwhile
   * (QA B3).
   */
  epoch: number;
};
let state: State = { accessToken: null, csrfToken: null, user: null, status: "unknown", epoch: 0 };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const authStore = {
  get: (): State => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setSession(s: AuthSession) {
    const epoch = state.user?.id === s.user.id ? state.epoch : state.epoch + 1;
    state = { ...state, accessToken: s.accessToken, user: s.user, status: "authenticated", epoch };
    emit();
  },
  setCsrfToken(t: string | null) {
    state = { ...state, csrfToken: t };
    emit();
  },
  clear() {
    state = {
      accessToken: null,
      csrfToken: null,
      user: null,
      status: "anonymous",
      epoch: state.epoch + 1,
    };
    emit();
  },
};
