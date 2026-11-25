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
  /**
   * A session restore is running right now (QA C1). Route guards wait for it instead of sending the
   * admin to the sign-in form, which is what flashed before "Page not found": `status` can already be
   * "anonymous" from an earlier attempt while the current one is still in flight.
   *
   * It starts `true`: the app attempts a restore on mount, and that attempt begins in an effect, i.e.
   * after the first paint. Without this the first paint would already decide, with nothing resolved.
   */
  restoring: boolean;
};
const initial = (): State => ({
  accessToken: null,
  csrfToken: null,
  user: null,
  status: "unknown",
  epoch: 0,
  restoring: true,
});
let state: State = initial();
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
    // A known session is a resolved one: nothing is being restored any more (QA C1).
    state = {
      ...state,
      accessToken: s.accessToken,
      user: s.user,
      status: "authenticated",
      epoch,
      restoring: false,
    };
    emit();
  },
  /** Test seam: back to the state of a freshly loaded page (a restore about to run). */
  reset() {
    state = initial();
    emit();
  },
  /** Marks a session restore as running; guards show the loader while it is (QA C1). */
  setRestoring(restoring: boolean) {
    if (state.restoring === restoring) return;
    state = { ...state, restoring };
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
      // A restore that is still running keeps the guards waiting (QA C1); its own `finally` ends it.
      restoring: state.restoring,
    };
    emit();
  },
};
