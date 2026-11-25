import { api, logout, primeCsrf, refreshSession } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { authStore, type AuthSession } from "./store";

// Admin auth flows (AUTH-02, AUTH-06, ADM-11). The role is enforced by the API on every
// /admin/* call; the checks here only decide what the UI shows (ADR-003, ADR-011).

export const ADMIN_ROLE = "ADMIN";

/**
 * A CUSTOMER session is never kept: it is revoked right away (the API created it) and the
 * login is rejected with the localized NOT_ADMIN message. No admin screen is ever rendered for it.
 */
async function acceptAdminSession(session: AuthSession): Promise<AuthSession> {
  if (session.user.role !== ADMIN_ROLE) {
    await logout();
    throw new ApiError({ status: 403, code: "NOT_ADMIN" });
  }
  authStore.setSession(session);
  await primeCsrf();
  return session;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const session = await api.post<AuthSession>("/auth/login", { email, password }, { skipAuth: true });
  return acceptAdminSession(session);
}

/** Admin invite (backend T-017): 200 stores the session like login. The code is never in the URL. */
export async function acceptInvite(email: string, code: string, password: string): Promise<AuthSession> {
  const session = await api.post<AuthSession>("/auth/accept-invite", { email, code, password }, { skipAuth: true });
  return acceptAdminSession(session);
}

/**
 * On app start the in-memory token is gone: try the refresh cookie once. The attempt is marked on the
 * store (QA C1) so route guards show the loader for as long as it runs - `status` may already say
 * "anonymous" from an earlier attempt, and redirecting on that flashed the sign-in form.
 */
export async function restoreSession(): Promise<void> {
  authStore.setRestoring(true);
  try {
    const session = await refreshSession();
    // A customer's cookie (same host as the storefront) must not open the dashboard. Only the
    // local state is dropped here: revoking would sign the person out of the storefront.
    if (session.user.role !== ADMIN_ROLE) authStore.clear();
  } catch {
    // Anonymous visitor or a transient failure: either way no session now.
    if (authStore.get().status === "unknown") authStore.clear();
  } finally {
    authStore.setRestoring(false);
  }
}

/**
 * Re-verifies a session the UI already believes in (QA A5): used when the browser restores this
 * document from the back/forward cache, where the whole heap of the old session comes back. Unlike
 * `restoreSession` this drops the local session on any failure - the refresh cookie is still there if
 * the session is in fact alive, so the next load signs the admin straight back in.
 */
export async function recheckSession(): Promise<void> {
  authStore.setRestoring(true);
  try {
    const session = await refreshSession();
    if (session.user.role !== ADMIN_ROLE) authStore.clear();
  } catch {
    authStore.clear();
  } finally {
    authStore.setRestoring(false);
  }
}

export { logout };
