import { authStore, type AuthSession } from "@/lib/auth/store";
import { ApiError, parseRetryAfter } from "./errors";

// Fetch wrapper (T-060; auth screens come in T-061). Base URL from VITE_API_URL
// (default http://localhost:1000/api/v1). The admin is cross-origin to the API, so the
// refresh cookie (`fx_rt`, Path=/api/v1/auth) is sent with credentials: "include".
// Cookie-authenticated calls (refresh, logout) first fetch the CSRF token from
// GET /auth/csrf and send it as X-CSRF-Token (ADR-011).

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:1000/api/v1";

type Deps = { fetch: typeof fetch; getLocale: () => string };
const defaultDeps: Deps = {
  fetch: (...a) => fetch(...a),
  getLocale: () => document.documentElement.lang || "ar",
};
let deps: Deps = defaultDeps;

/** Test seam. */
export function configureApiClient(o: Partial<Deps> | null) {
  deps = o ? { ...defaultDeps, ...o } : defaultDeps;
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  skipAuth?: boolean;
  signal?: AbortSignal;
};

async function toApiError(res: Response): Promise<ApiError> {
  let code = "INTERNAL_ERROR";
  let message: string | undefined;
  let requestId: string | undefined;
  let details: unknown;
  try {
    const b = (await res.json()) as { code?: string; message?: string; requestId?: string; details?: unknown };
    if (typeof b.code === "string") code = b.code;
    message = b.message;
    requestId = b.requestId;
    details = b.details;
  } catch {
    /* non-JSON body */
  }
  return new ApiError({
    status: res.status,
    code,
    message,
    requestId,
    details,
    retryAfterSeconds: parseRetryAfter(res.headers.get("Retry-After")),
  });
}

async function send(path: string, o: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": deps.getLocale(),
    ...o.headers,
  };
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (token && !o.skipAuth) headers.Authorization = `Bearer ${token}`;
  try {
    return await deps.fetch(`${API_BASE}${path}`, {
      method: o.method ?? "GET",
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      credentials: "include",
      signal: o.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError({ status: 0, code: "NETWORK_ERROR" });
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function rawRequest<T>(path: string, o: RequestOptions = {}): Promise<T> {
  return parse<T>(await send(path, o, null));
}

async function fetchCsrf(force = false): Promise<string> {
  const cached = authStore.get().csrfToken;
  if (cached && !force) return cached;
  const { csrfToken } = await rawRequest<{ csrfToken: string }>("/auth/csrf");
  authStore.setCsrfToken(csrfToken);
  return csrfToken;
}

/** Cookie-authenticated POST: CSRF token first, one retry with a fresh token on CSRF_INVALID. */
async function csrfPost<T>(path: string): Promise<T> {
  let retried = false;
  for (;;) {
    const csrf = await fetchCsrf();
    try {
      return await rawRequest<T>(path, { method: "POST", headers: { "X-CSRF-Token": csrf } });
    } catch (e) {
      if (e instanceof ApiError && e.code === "CSRF_INVALID" && !retried) {
        retried = true;
        authStore.setCsrfToken(null);
        continue;
      }
      throw e;
    }
  }
}

let inFlightRefresh: Promise<AuthSession> | null = null;

/** Fetch and cache the CSRF token (after login / accept-invite). Failure is non-fatal here. */
export async function primeCsrf(): Promise<void> {
  try {
    await fetchCsrf(true);
  } catch {
    /* retried lazily on the next refresh/logout */
  }
}

async function doRefresh(): Promise<AuthSession> {
  let csrfRetried = false;
  let raceRetried = false;
  for (;;) {
    try {
      const csrf = await fetchCsrf();
      const session = await rawRequest<AuthSession>("/auth/refresh", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
      });
      authStore.setSession(session);
      return session;
    } catch (e) {
      if (e instanceof ApiError) {
        // Another tab rotated the cookie < 10 s ago: retry once with the new cookie; never log out (backend T-005).
        if (e.code === "REFRESH_RACE" && !raceRetried) {
          raceRetried = true;
          continue;
        }
        if (e.code === "CSRF_INVALID" && !csrfRetried) {
          csrfRetried = true;
          authStore.setCsrfToken(null);
          continue;
        }
        // Transient: keep the session state, the caller decides.
        if (e.code === "REFRESH_RACE" || e.status === 0 || e.status >= 500 || e.status === 429) throw e;
      }
      authStore.clear();
      throw e;
    }
  }
}

/** Single-flight refresh (backend T-005): concurrent callers share one request. */
export function refreshSession(): Promise<AuthSession> {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** Revokes the session; always clears local auth state, even if the call fails. */
export async function logout(): Promise<void> {
  try {
    await csrfPost<void>("/auth/logout");
  } finally {
    authStore.clear();
  }
}

/** JSON request; on 401 UNAUTHORIZED refreshes once (single-flight) and retries once. */
export async function apiRequest<T>(path: string, o: RequestOptions = {}): Promise<T> {
  const res = await send(path, o, authStore.get().accessToken);
  if (res.status !== 401 || o.skipAuth) return parse<T>(res);
  const failure = await toApiError(res);
  if (failure.code !== "UNAUTHORIZED") throw failure;
  let session: AuthSession;
  try {
    session = await refreshSession();
  } catch {
    throw failure;
  }
  return parse<T>(await send(path, o, session.accessToken));
}

export const api = {
  get: <T>(p: string, o?: Omit<RequestOptions, "method" | "body">) => apiRequest<T>(p, { ...o, method: "GET" }),
  post: <T>(p: string, body?: unknown, o?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(p, { ...o, method: "POST", body }),
  put: <T>(p: string, body?: unknown, o?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(p, { ...o, method: "PUT", body }),
  patch: <T>(p: string, body?: unknown, o?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(p, { ...o, method: "PATCH", body }),
  delete: <T>(p: string, o?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(p, { ...o, method: "DELETE" }),
};
