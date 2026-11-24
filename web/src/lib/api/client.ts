import { ApiError, parseRetryAfter } from "./errors";
import { useAuthStore, type AuthSession } from "../auth/store";

// Fetch wrapper (T-031, AUTH-05). Base path is relative and same-origin
// (NEXT_PUBLIC_API_URL=/api/v1, rewritten to the backend by next.config, ADR-011),
// so the host-only `fx_rt` cookie is first-party. Never call the backend origin here.

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";

type FetchFn = typeof fetch;
type Deps = { fetch: FetchFn; getLocale: () => string };

const defaultDeps: Deps = {
  fetch: (...args) => fetch(...args),
  getLocale: () =>
    typeof document !== "undefined" && document.documentElement.lang
      ? document.documentElement.lang
      : "ar",
};
let deps: Deps = defaultDeps;

/** Test seam. */
export function configureApiClient(overrides: Partial<Deps> | null) {
  deps = overrides ? { ...defaultDeps, ...overrides } : defaultDeps;
}

export type RequestOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  /** Do not attach the access token or try a refresh on 401 (auth endpoints). */
  skipAuth?: boolean;
  signal?: AbortSignal;
};

async function toApiError(res: Response): Promise<ApiError> {
  let code = "INTERNAL_ERROR";
  let message: string | undefined;
  let requestId: string | undefined;
  let details: unknown;
  try {
    const body = (await res.json()) as {
      code?: string;
      message?: string;
      requestId?: string;
      details?: unknown;
    };
    details = body.details;
    if (typeof body.code === "string") code = body.code;
    message = body.message;
    requestId = body.requestId;
  } catch {
    /* non-JSON body: keep the generic code */
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

async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Language": deps.getLocale(),
    ...opts.headers,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (token && !opts.skipAuth) headers.Authorization = `Bearer ${token}`;
  try {
    return await deps.fetch(`${API_BASE}${path}`, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      signal: opts.signal,
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

/** Raw request with no auth handling; used by the refresh flow itself. */
export async function rawRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return parse<T>(await send(path, opts, null));
}

let inFlightRefresh: Promise<AuthSession> | null = null;

async function fetchCsrf(force = false): Promise<string> {
  const cached = useAuthStore.getState().csrfToken;
  if (cached && !force) return cached;
  const { csrfToken } = await rawRequest<{ csrfToken: string }>("/auth/csrf");
  useAuthStore.getState().setCsrfToken(csrfToken);
  return csrfToken;
}

/** Fetch and cache the CSRF token (after login / verify-otp). Failure is non-fatal here. */
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
      useAuthStore.getState().setSession(session);
      return session;
    } catch (e) {
      if (e instanceof ApiError) {
        // Another tab rotated the cookie <10 s ago: retry once with the new cookie; never log out.
        if (e.code === "REFRESH_RACE" && !raceRetried) {
          raceRetried = true;
          continue;
        }
        if (e.code === "CSRF_INVALID" && !csrfRetried) {
          csrfRetried = true;
          useAuthStore.getState().setCsrfToken(null);
          continue;
        }
        if (e.code === "REFRESH_RACE" || e.status === 0 || e.status >= 500 || e.status === 429) {
          throw e; // transient: keep the session state, caller decides
        }
      }
      useAuthStore.getState().clear();
      throw e;
    }
  }
}

/** Single-flight: every concurrent caller shares one in-flight refresh (backend T-005). */
export function refreshSession(): Promise<AuthSession> {
  if (!inFlightRefresh) {
    inFlightRefresh = doRefresh().finally(() => {
      inFlightRefresh = null;
    });
  }
  return inFlightRefresh;
}

/** JSON request. On 401 it refreshes once (single-flight) and retries once. */
export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const res = await send(path, opts, token);
  if (res.status !== 401 || opts.skipAuth) return parse<T>(res);

  const failure = await toApiError(res);
  if (failure.code !== "UNAUTHORIZED") throw failure;
  let session: AuthSession;
  try {
    session = await refreshSession();
  } catch {
    throw failure;
  }
  return parse<T>(await send(path, opts, session.accessToken));
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "PATCH", body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, "method" | "body">) =>
    apiRequest<T>(path, { ...opts, method: "DELETE" }),
};
