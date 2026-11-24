import { io as defaultIo, type Socket } from "socket.io-client";

import { refreshSession } from "@/lib/api/client";
import { logout } from "@/lib/auth/session";
import { useAuthStore } from "@/lib/auth/store";

import { receiveNotification, refreshNotifications } from "./store";

// Socket client per ADR-012 / integrations.md. Connects to the backend origin directly
// (a websocket upgrade does not survive the Next rewrite). Auth = access token via a
// function so every (re)connect sends the current token.

type IoFn = typeof defaultIo;
let ioImpl: IoFn = defaultIo;

/** Test seam. */
export function configureSocket(io: IoFn | null) {
  ioImpl = io ?? defaultIo;
}

const REFRESH_WINDOW_MS = 60_000;

function tokenExpiry(token: string): number | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Current access token; refreshes first when it expires within 60 s. Null when there is no session. */
export async function getFreshToken(): Promise<string | null> {
  const token = useAuthStore.getState().accessToken;
  if (!token) return null;
  const exp = tokenExpiry(token);
  if (exp !== null && exp - Date.now() < REFRESH_WINDOW_MS) {
    try {
      return (await refreshSession()).accessToken;
    } catch {
      return null;
    }
  }
  return token;
}

const quiet = (p: Promise<unknown>) => void p.catch(() => undefined);

/** Open the socket and wire the NOTIF-01 behaviour. Returns a stop function. */
export function startLiveNotifications(url: string | undefined = process.env.NEXT_PUBLIC_SOCKET_URL): () => void {
  if (!url) {
    quiet(refreshNotifications()); // no socket configured: still show the REST state once
    return () => undefined;
  }
  let authRetried = false;
  const socket: Socket = ioImpl(url, {
    path: "/api/socket-io",
    addTrailingSlash: false,
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    randomizationFactor: 0.5,
    auth: (cb: (data: object) => void) => {
      void getFreshToken().then((token) => cb({ token: token ?? "" }));
    },
  });

  socket.on("connect", () => {
    authRetried = false;
    quiet(refreshNotifications()); // first connect and every reconnect
  });
  socket.on("notification:new", receiveNotification);
  socket.on("connect_error", (err: Error) => {
    if (err?.message !== "unauthorized") return; // other errors: socket.io retries with backoff
    if (authRetried) {
      void logout(); // second failure in a row
      return;
    }
    authRetried = true;
    refreshSession().then(
      () => socket.connect(),
      () => void logout(),
    );
  });
  socket.on("disconnect", (reason: string) => {
    // The server kicked us (token expired): socket.io does not reconnect by itself.
    if (reason !== "io server disconnect") return;
    void getFreshToken().then((t) => {
      if (t) socket.connect();
    });
  });

  return () => {
    socket.off();
    socket.disconnect();
  };
}
