import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore, type AuthUser } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { configureSocket } from "@/lib/notifications/socket";
import { NotificationsSync } from "@/components/notifications/live";
import { configureChime, notificationStore, resetNotifications, SOUND_KEY } from "@/lib/notifications/store";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

const admin: AuthUser = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};
const ORDER = "d".repeat(24);
const nid = (i: number) => i.toString(16).padStart(24, "0");
type N = {
  id: string;
  type: string;
  title: { en: string; ar: string };
  body: { en: string; ar: string };
  data: { orderId: string; orderNo: string } | null;
  readAt: string | null;
  createdAt: string;
};
const notif = (i: number, over: Partial<N> = {}): N => ({
  id: nid(i),
  type: "NEW_ORDER",
  title: { en: `New order ${i}`, ar: `طلب جديد ${i}` },
  body: { en: `Order FX-${i} was placed`, ar: `تم إنشاء الطلب FX-${i}` },
  data: { orderId: ORDER, orderNo: `FX-${i}` },
  readAt: null,
  createdAt: "2026-11-24T08:00:00.000Z",
  ...over,
});

type Call = { path: string; method: string };
let calls: Call[] = [];
let server: N[] = [];
function stubApi(listStatus = 200) {
  calls = [];
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      calls.push({ path, method });
      const j = (b: unknown, status = 200) =>
        new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
      if (path === "/auth/csrf") return j({ csrfToken: "c" });
      if (path === "/auth/refresh") return j({ accessToken: "fresh", user: admin });
      if (path.startsWith("/notifications?")) {
        if (listStatus !== 200) return j({ code: "INTERNAL_ERROR" }, listStatus);
        const q = new URLSearchParams(path.split("?")[1]);
        const page = Number(q.get("page"));
        const limit = Number(q.get("limit"));
        return j({
          items: server.slice((page - 1) * limit, page * limit),
          meta: { page, limit, total: server.length, totalPages: Math.max(1, Math.ceil(server.length / limit)) },
          unread: server.filter((n) => !n.readAt).length,
        });
      }
      const one = /^\/notifications\/(\w+)\/read$/.exec(path);
      if (one && method === "PATCH") {
        const row = server.find((n) => n.id === one[1]);
        if (row) row.readAt = "2026-11-24T09:00:00.000Z";
        return new Response(null, { status: 204 });
      }
      if (path === "/notifications/read-all" && method === "POST") {
        server.forEach((n) => (n.readAt = n.readAt ?? "2026-11-24T09:00:00.000Z"));
        return new Response(null, { status: 204 });
      }
      return j({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

type Handler = (...a: unknown[]) => void;
class FakeSocket {
  handlers = new Map<string, Handler[]>();
  connectCalls = 0;
  disconnected = false;
  constructor(
    public url: string,
    public opts: Record<string, unknown>,
  ) {}
  on(ev: string, h: Handler) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), h]);
    return this;
  }
  off() {
    this.handlers.clear();
    return this;
  }
  connect() {
    this.connectCalls++;
    return this;
  }
  disconnect() {
    this.disconnected = true;
    return this;
  }
  fire(ev: string, ...a: unknown[]) {
    (this.handlers.get(ev) ?? []).forEach((h) => h(...a));
  }
}
let sockets: FakeSocket[] = [];
const fakeIo = ((url: string, opts: Record<string, unknown>) => {
  const s = new FakeSocket(url, opts);
  sockets.push(s);
  return s;
}) as never;

const tick = (ms = 0) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const connect = async (s: FakeSocket) => {
  await act(async () => {
    s.fire("connect");
    await new Promise((r) => setTimeout(r, 0));
  });
};

function mount(path: string) {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={[path]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

let chimes = 0;
beforeEach(() => {
  vi.stubEnv("VITE_SOCKET_URL", "http://localhost:1000");
  authStore.clear();
  authStore.setSession({ accessToken: "tok-1", user: admin });
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  resetNotifications();
  sockets = [];
  server = [];
  chimes = 0;
  configureSocket(fakeIo);
  configureChime(() => void chimes++);
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
  configureSocket(null);
  configureChime(null);
  vi.unstubAllEnvs();
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-10 · live notifications (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
  });

  it("ADM-10 · connects per ADR-012 with a function auth that sends the CURRENT token on every attempt", async () => {
    stubApi();
    mount("/");
    await tick();
    expect(sockets).toHaveLength(1);
    const s = sockets[0];
    expect(s.url).toBe("http://localhost:1000");
    expect(s.opts).toMatchObject({
      path: "/api/socket-io",
      addTrailingSlash: false,
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
      randomizationFactor: 0.5,
    });
    expect(typeof s.opts.auth).toBe("function");
    const auth = s.opts.auth as (cb: (d: object) => void) => void;
    expect(await new Promise<object>((r) => auth(r))).toEqual({ token: "fresh" });
    act(() => authStore.setSession({ accessToken: "tok-2", user: admin }));
    expect(await new Promise<object>((r) => auth(r))).toEqual({ token: "tok-2" });
  });

  it("ADM-10 · the top-bar bell shows the unread badge and links to the list", async () => {
    stubApi();
    mount("/");
    await tick();
    const bell = screen.getByTestId("bell");
    expect(bell.getAttribute("href")).toBe("/notifications");
    expect(screen.queryByTestId("notifications-count")).toBeNull();
    await connect(sockets[0]);
    act(() => sockets[0].fire("notification:new", notif(1)));
    expect(screen.getByTestId("notifications-count").textContent).toBe("1");
    expect(screen.getByTestId("bell").getAttribute("aria-label")).toBe(msgs.notifications.bellUnread.replace("{n}", "1"));
  });

  it("ADM-10 · no socket for a customer or a guest; logout closes it and clears the badge", async () => {
    stubApi();
    const bare = () => render(<NotificationsSync />);
    authStore.clear();
    bare();
    await tick();
    expect(sockets).toHaveLength(0);
    cleanup();
    authStore.setSession({ accessToken: "t", user: { ...admin, role: "CUSTOMER" } });
    bare();
    await tick();
    expect(sockets).toHaveLength(0);
    cleanup();
    authStore.setSession({ accessToken: "t", user: admin });
    bare();
    await tick();
    expect(sockets).toHaveLength(1);
    await connect(sockets[0]);
    act(() => sockets[0].fire("notification:new", notif(1)));
    expect(notificationStore.get().unread).toBe(1);
    act(() => authStore.clear());
    expect(sockets[0].disconnected).toBe(true);
    expect(notificationStore.get().unread).toBe(0);
  });

  it("ADM-10 · after 'io server disconnect' it refreshes and calls connect() itself; other reasons are left to socket.io", async () => {
    stubApi();
    mount("/");
    await tick();
    const s = sockets[0];
    await act(async () => {
      s.fire("disconnect", "transport close");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.connectCalls).toBe(0);
    await act(async () => {
      s.fire("disconnect", "io server disconnect");
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(s.connectCalls).toBe(1);
  });

  it("ADM-10 · an 'unauthorized' connect error refreshes once and retries; a second one signs out", async () => {
    stubApi();
    mount("/");
    await tick();
    const s = sockets[0];
    await act(async () => {
      s.fire("connect_error", new Error("rate_limited"));
      await new Promise((r) => setTimeout(r, 0));
    });
    const refreshes = () => calls.filter((c) => c.path === "/auth/refresh").length;
    const base = refreshes(); // the app's own session restore on mount
    expect(s.connectCalls).toBe(0);
    await act(async () => {
      s.fire("connect_error", new Error("unauthorized"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(refreshes()).toBe(base + 1);
    expect(s.connectCalls).toBe(1);
    await act(async () => {
      s.fire("connect_error", new Error("unauthorized"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(calls.some((c) => c.path === "/auth/logout")).toBe(true);
    expect(authStore.get().status).toBe("anonymous");
  });

  it("ADM-10 · works in dark mode (tokens only)", async () => {
    stubApi();
    localStorage.setItem(THEME_KEY, "dark");
    mount("/notifications");
    await screen.findByText(msgs.notifications.empty);
    expect(screen.getByTestId("bell")).toBeTruthy();
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("NOTIF-02 · admin toast + sound (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });
  const title = (i: number) => (locale === "en" ? `New order ${i}` : `طلب جديد ${i}`);

  it("NOTIF-02 · a new order shows a toast linking to the order, plays the sound and raises the bell count", async () => {
    stubApi();
    mount("/");
    await tick();
    await connect(sockets[0]);
    act(() => sockets[0].fire("notification:new", notif(1)));
    const toast = screen.getByTestId("notification-toast");
    expect(toast.textContent).toContain(title(1));
    expect(toast.querySelector("a")!.getAttribute("href")).toBe(`/orders/${ORDER}`);
    expect(chimes).toBe(1);
    expect(screen.getByTestId("notifications-count").textContent).toBe("1");
    // the same row re-delivered is neither counted nor toasted twice
    act(() => sockets[0].fire("notification:new", notif(1)));
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
    expect(chimes).toBe(1);
  });

  it("NOTIF-02 · the sound can be toggled off and the choice is remembered; the toast still shows", async () => {
    stubApi();
    mount("/");
    await tick();
    await connect(sockets[0]);
    fireEvent.click(screen.getByTestId("sound-toggle"));
    expect(localStorage.getItem(SOUND_KEY)).toBe("0");
    expect(screen.getByTestId("sound-toggle").getAttribute("aria-label")).toBe(msgs.notifications.soundOff);
    act(() => sockets[0].fire("notification:new", notif(1)));
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
    expect(chimes).toBe(0);
  });

  it("NOTIF-02 · toasts can be dismissed and expire on their own", async () => {
    stubApi();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mount("/");
      await tick();
      await connect(sockets[0]);
      act(() => sockets[0].fire("notification:new", notif(1)));
      fireEvent.click(screen.getByRole("button", { name: msgs.notifications.dismiss }));
      expect(screen.queryByTestId("notification-toast")).toBeNull();
      act(() => sockets[0].fire("notification:new", notif(2)));
      expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(6100);
      });
      expect(screen.queryByTestId("notification-toast")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("NOTIF-02 · an order notification created while disconnected appears after reconnect: bell count, list and a grouped toast", async () => {
    server = [notif(1, { readAt: "2026-11-24T07:00:00.000Z" })];
    stubApi();
    mount("/");
    await tick();
    await connect(sockets[0]); // first connect = baseline: no toast for what existed
    expect(screen.queryByTestId("notification-toast")).toBeNull();
    expect(screen.queryByTestId("notifications-count")).toBeNull();

    act(() => sockets[0].fire("disconnect", "transport close"));
    server = [...[2, 3, 4, 5].map((i) => notif(i)), ...server]; // 4 created during the gap
    await connect(sockets[0]); // reconnect
    expect(calls.filter((c) => c.path.startsWith("/notifications?page=1"))).toHaveLength(2);
    expect(screen.getByTestId("notifications-count").textContent).toBe("4");
    const toasts = screen.getAllByTestId("notification-toast");
    expect(toasts).toHaveLength(1);
    expect(toasts[0].textContent).toContain(msgs.notifications.grouped.replace("{count}", "4"));
    expect(chimes).toBe(1);
    expect(toasts[0].querySelector("a")!.getAttribute("href")).toBe("/notifications");
    fireEvent.click(toasts[0].querySelector("a")!);
    await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(5));
  });

  it("NOTIF-02 · up to 3 missed notifications get one toast each", async () => {
    stubApi();
    mount("/");
    await tick();
    await connect(sockets[0]);
    server = [2, 3].map((i) => notif(i));
    await connect(sockets[0]);
    expect(screen.getAllByTestId("notification-toast")).toHaveLength(2);
  });
});

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("NOTIF-03 · notification centre (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
  });

  it("NOTIF-03 · lists notifications paginated, marks one as read and opens its order", async () => {
    server = Array.from({ length: 25 }, (_, i) => notif(i + 1));
    stubApi();
    mount("/notifications");
    expect(await screen.findAllByTestId("notification-row")).toHaveLength(20);
    expect(screen.getByText(msgs.notifications.pageOf.replace("{page}", "1").replace("{total}", "2"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: msgs.notifications.next }));
    await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: msgs.notifications.previous }));
    await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(20));

    const first = screen.getAllByTestId("notification-row")[0];
    expect(first.getAttribute("data-unread")).toBe("true");
    fireEvent.click(first);
    await waitFor(() =>
      expect(calls.some((c) => c.method === "PATCH" && c.path === `/notifications/${nid(1)}/read`)).toBe(true),
    );
    expect(server[0].readAt).not.toBeNull();
    // navigated to the order detail (route renders there; the list is gone)
    await waitFor(() => expect(screen.queryByTestId("notifications-list")).toBeNull());
  });

  it("NOTIF-03 · mark all as read", async () => {
    server = [1, 2, 3].map((i) => notif(i));
    stubApi();
    mount("/notifications");
    await screen.findAllByTestId("notification-row");
    fireEvent.click(screen.getByRole("button", { name: msgs.notifications.markAllRead }));
    await waitFor(() => expect(calls.some((c) => c.path === "/notifications/read-all" && c.method === "POST")).toBe(true));
    await waitFor(() =>
      screen.getAllByTestId("notification-row").forEach((r) => expect(r.getAttribute("data-unread")).toBe("false")),
    );
    expect(
      (screen.getByRole("button", { name: msgs.notifications.markAllRead }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("NOTIF-03 · notifications created while the admin was offline are listed on the next load; empty state and error with retry", async () => {
    server = [notif(1)];
    stubApi();
    mount("/notifications");
    expect(await screen.findAllByTestId("notification-row")).toHaveLength(1);
    cleanup();
    server = [];
    stubApi();
    mount("/notifications");
    expect(await screen.findByText(msgs.notifications.empty)).toBeTruthy();
    cleanup();
    stubApi(500);
    mount("/notifications");
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: msgs.notifications.retry })).toBeTruthy();
  });
});
