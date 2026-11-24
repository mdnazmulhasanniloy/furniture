import { api, primeCsrf, rawRequest, refreshSession } from "../api/client";
import { useAuthStore, type AuthSession } from "./store";

/** Store a session returned by login / verify-otp and cache the CSRF token (backend T-005). */
export async function establishSession(session: AuthSession): Promise<void> {
  useAuthStore.getState().setSession(session);
  await primeCsrf();
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const session = await api.post<AuthSession>(
    "/auth/login",
    { email, password },
    { skipAuth: true },
  );
  await establishSession(session);
  return session;
}

/** Revoke the session server-side; local state is cleared even if the call fails. */
export async function logout(): Promise<void> {
  const { csrfToken, accessToken } = useAuthStore.getState();
  try {
    let csrf = csrfToken;
    if (!csrf) {
      try {
        csrf = (await rawRequest<{ csrfToken: string }>("/auth/csrf")).csrfToken;
      } catch {
        csrf = null; // no cookie: Bearer-only logout is allowed by the API
      }
    }
    await rawRequest<void>("/auth/logout", {
      method: "POST",
      headers: {
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
  } catch {
    /* best effort */
  } finally {
    useAuthStore.getState().clear();
  }
}

/**
 * Re-verifies a session the UI already believes in (QA A5): used when the browser restores this
 * document from the back/forward cache, where the heap of the old session comes back as it was. Unlike
 * `restoreSession` this drops the local session on any failure - the refresh cookie is still there if
 * the session is in fact alive, so the next load signs the customer straight back in.
 */
export async function recheckSession(): Promise<void> {
  try {
    await refreshSession();
  } catch {
    useAuthStore.getState().clear();
  }
}

/** On app start the in-memory token is gone: try the refresh cookie once. */
export async function restoreSession(): Promise<void> {
  try {
    await refreshSession();
  } catch {
    // Anonymous visitor (no cookie) or a transient failure: either way, no session now.
    if (useAuthStore.getState().status === "unknown") useAuthStore.getState().clear();
  }
}
