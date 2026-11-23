// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ar from "../../messages/ar.json";
import en from "../../messages/en.json";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => "/",
}));
const logoutMock = vi.fn(async () => undefined);
vi.mock("@/lib/auth/session", () => ({ logout: () => logoutMock(), restoreSession: vi.fn() }));

import { AccountActions } from "@/components/layout/account-menu";
import { NotificationsPanel } from "@/components/notifications/notifications-panel";
import { NotificationsSync } from "@/components/notifications/sync";
import { NotificationToaster } from "@/components/notifications/toaster";
import { configureApiClient } from "@/lib/api/client";
import { useAuthStore } from "@/lib/auth/store";
import { configureSocket } from "@/lib/notifications/socket";
import { refreshNotifications, resetNotifications, useNotificationStore } from "@/lib/notifications/store";

type L = "en" | "ar";
const messages = { en, ar } as const;
const wrap = (locale: L, ui: React.ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]}>
      {ui}
    </NextIntlClientProvider>,
  );
};

const ORDER = "d".repeat(24);
const nid = (i: number) => i.toString(16).padStart(24, "0");
const notif = (i: number, over: Record<string, unknown> = {}) => ({
  id: nid(i),
  type: "ORDER_STATUS",
  title: { en: `Order update ${i}`, ar: `تحديث الطلب ${i}` },
  body: { en: `Your order is confirmed (${i})`, ar: `تم تأكيد طلبك (${i})` },
  link: `/orders/${ORDER}`,
  data: { orderId: ORDER, orderNo: "FX-1", status: "CONFIRMED" },
  readAt: null,
  createdAt: "2026-11-24T08:00:00.000Z",
  ...over,
});

// ---- mocked REST ----
type Call = { path: string; method: string };
let calls: Call[] = [];
let server: Array<ReturnType<typeof notif> | (Omit<ReturnType<typeof notif>, "readAt"> & { readAt: string | null })> = [];
function mockApi(opts: { failList?: boolean } = {}) {
  calls = [];
  configureApiClient({
    getLocale: () => "en",
    fetch: (async (url: string, init: RequestInit) => {
      const path = String(url).replace(/^.*\/api\/v1/, "");
      const method = init.method ?? "GET";
      calls.push({ path, method });
      if (path.startsWith("/notifications?")) {
        if (opts.failList) return new Response("{}", { status: 500 });
        const q = new URLSearchParams(path.split("?")[1]);
        const page = Number(q.get("page"));
        const limit = Number(q.get("limit"));
        const items = server.slice((page - 1) * limit, page * limit);
        return Response.json({
          items,
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
      if (path === "/notifications/read-all") {
        server.forEach((n) => (n.readAt = n.readAt ?? "2026-11-24T09:00:00.000Z"));
        return new Response(null, { status: 204 });
      }
      return new Response("{}", { status: 404 });
    }) as typeof fetch,
  });
}

// ---- mocked socket ----
type Handler = (...a: unknown[]) => void;
class FakeSocket {
  handlers = new Map<string, Handler[]>();
  connectCalls = 0;
  disconnected = false;
  constructor(public url: string, public opts: Record<string, unknown>) {}
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

const login = (over: Record<string, unknown> = {}) =>
  useAuthStore.setState({
    status: "authenticated",
    accessToken: "tok-1",
    user: {
      id: "u", firstName: "Sara", lastName: "Ali", email: "s@x.sa", role: "CUSTOMER",
      isVerified: true, isBlocked: false, preferredLocale: "ar", ...over,
    } as never,
  });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SOCKET_URL", "http://localhost:1000");
  push.mockClear();
  logoutMock.mockClear();
  sockets = [];
  server = [];
  resetNotifications();
  useAuthStore.getState().clear();
  configureSocket(fakeIo);
});
afterEach(() => {
  cleanup();
  configureApiClient(null);
  configureSocket(null);
  vi.unstubAllEnvs();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const connect = async (s: FakeSocket) => {
  await act(async () => { s.fire("connect"); await new Promise((r) => setTimeout(r, 0)); });
};

for (const locale of ["en", "ar"] as const) {
  const m = messages[locale];

  describe(`NOTIF-01 · live notifications (${locale})`, () => {
    const Shell = () => (
      <>
        <NotificationsSync />
        <AccountActions />
        <NotificationToaster />
      </>
    );

    it(`NOTIF-01 · connects per ADR-012 with a function auth that sends the CURRENT token on every attempt (${locale})`, async () => {
      login();
      mockApi();
      wrap(locale, <Shell />);
      await flush();
      expect(sockets).toHaveLength(1);
      const s = sockets[0];
      expect(s.url).toBe("http://localhost:1000");
      expect(s.opts).toMatchObject({
        path: "/api/socket-io", addTrailingSlash: false, transports: ["websocket"], reconnection: true,
        reconnectionDelay: 1000, reconnectionDelayMax: 15000, randomizationFactor: 0.5,
      });
      expect(typeof s.opts.auth).toBe("function");
      const auth = s.opts.auth as (cb: (d: object) => void) => void;
      const first = await new Promise<object>((r) => auth(r));
      expect(first).toEqual({ token: "tok-1" });
      act(() => useAuthStore.setState({ accessToken: "tok-2" }));
      const second = await new Promise<object>((r) => auth(r));
      expect(second).toEqual({ token: "tok-2" });
    });

    it(`NOTIF-01 · a live notification raises the bell badge and shows a toast without a refresh (${locale})`, async () => {
      login();
      mockApi();
      wrap(locale, <Shell />);
      await flush();
      await connect(sockets[0]);
      expect(screen.queryByTestId("notifications-count")).toBeNull();
      act(() => sockets[0].fire("notification:new", notif(1)));
      expect(screen.getByTestId("notifications-count").textContent).toBe("1");
      expect(screen.getByTestId("notifications-bell").getAttribute("aria-label")).toContain(locale === "en" ? "1 unread" : "غير مقروء");
      const toast = screen.getByTestId("notification-toast");
      expect(toast.textContent).toContain(locale === "en" ? "Order update 1" : "تحديث الطلب 1");
      expect(toast.querySelector("a")!.getAttribute("href")).toBe(`/account/orders/${ORDER}`);
      // the same row again (e.g. re-delivered) is not counted twice
      act(() => sockets[0].fire("notification:new", notif(1)));
      expect(screen.getByTestId("notifications-count").textContent).toBe("1");
      expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
    });

    it(`NOTIF-01 · a notification created while disconnected is shown after reconnect: bell count, list and a grouped toast (${locale})`, async () => {
      login();
      server = [notif(1, { readAt: "2026-11-24T07:00:00.000Z" })];
      mockApi();
      wrap(locale, <Shell />);
      await flush();
      await connect(sockets[0]); // first connect: baseline, no toast for what existed
      expect(screen.queryByTestId("notification-toast")).toBeNull();
      expect(screen.queryByTestId("notifications-count")).toBeNull();

      act(() => sockets[0].fire("disconnect", "transport close"));
      server = [...[2, 3, 4, 5].map((i) => notif(i)), ...server]; // 4 created during the gap
      await connect(sockets[0]); // reconnect
      expect(calls.filter((c) => c.path.startsWith("/notifications?page=1"))).toHaveLength(2);
      expect(screen.getByTestId("notifications-count").textContent).toBe("4");
      const toasts = screen.getAllByTestId("notification-toast");
      expect(toasts).toHaveLength(1);
      expect(toasts[0].textContent).toContain(m.notifications.grouped.replace("{count}", "4"));
      expect(useNotificationStore.getState().items.map((n) => n.id)).toContain(nid(5));

      // the list page shows them too
      cleanup();
      wrap(locale, <NotificationsPanel />);
      await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(5));
    });

    it(`NOTIF-01 · up to 3 missed notifications get one toast each (${locale})`, async () => {
      login();
      mockApi();
      wrap(locale, <Shell />);
      await flush();
      await connect(sockets[0]);
      server = [2, 3].map((i) => notif(i));
      await connect(sockets[0]);
      expect(screen.getAllByTestId("notification-toast")).toHaveLength(2);
    });

    it(`NOTIF-01 · after "io server disconnect" the client refreshes the token and calls connect() itself; other reasons are left to socket.io (${locale})`, async () => {
      login();
      mockApi();
      wrap(locale, <Shell />);
      await flush();
      const s = sockets[0];
      await act(async () => { s.fire("disconnect", "transport close"); await new Promise((r) => setTimeout(r, 0)); });
      expect(s.connectCalls).toBe(0);
      await act(async () => { s.fire("disconnect", "io server disconnect"); await new Promise((r) => setTimeout(r, 0)); });
      expect(s.connectCalls).toBe(1);
    });

    it(`NOTIF-01 · an "unauthorized" connect error refreshes once and retries; a second one logs out (${locale})`, async () => {
      login();
      let refreshes = 0;
      configureApiClient({
        getLocale: () => "en",
        fetch: (async (url: string) => {
          const path = String(url).replace(/^.*\/api\/v1/, "");
          if (path === "/auth/csrf") return Response.json({ csrfToken: "c" });
          if (path === "/auth/refresh") {
            refreshes++;
            return Response.json({ accessToken: `fresh-${refreshes}`, user: useAuthStore.getState().user });
          }
          return Response.json({ items: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 }, unread: 0 });
        }) as typeof fetch,
      });
      wrap(locale, <NotificationsSync />);
      await flush();
      const s = sockets[0];
      await act(async () => { s.fire("connect_error", new Error("rate_limited")); await new Promise((r) => setTimeout(r, 0)); });
      expect(refreshes).toBe(0);
      expect(s.connectCalls).toBe(0);
      await act(async () => { s.fire("connect_error", new Error("unauthorized")); await new Promise((r) => setTimeout(r, 20)); });
      expect(refreshes).toBe(1);
      expect(s.connectCalls).toBe(1);
      expect(useAuthStore.getState().accessToken).toBe("fresh-1");
      expect(logoutMock).not.toHaveBeenCalled();
      await act(async () => { s.fire("connect_error", new Error("unauthorized")); await new Promise((r) => setTimeout(r, 20)); });
      expect(logoutMock).toHaveBeenCalledTimes(1);
    });

    it(`NOTIF-01 · no socket for guests or admins; logging out closes it and clears the badge (${locale})`, async () => {
      mockApi();
      useAuthStore.getState().clear();
      wrap(locale, <NotificationsSync />);
      await flush();
      expect(sockets).toHaveLength(0);
      cleanup();
      login({ role: "ADMIN" });
      wrap(locale, <NotificationsSync />);
      await flush();
      expect(sockets).toHaveLength(0);
      cleanup();
      login();
      wrap(locale, <NotificationsSync />);
      await flush();
      expect(sockets).toHaveLength(1);
      act(() => sockets[0].fire("notification:new", notif(1)));
      expect(useNotificationStore.getState().unread).toBe(1);
      act(() => useAuthStore.getState().clear());
      expect(sockets[0].disconnected).toBe(true);
      expect(useNotificationStore.getState().unread).toBe(0);
    });

    it(`NOTIF-01 · toasts can be dismissed and expire on their own (${locale})`, async () => {
      login();
      mockApi();
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        wrap(locale, <Shell />);
        await flush();
        await connect(sockets[0]);
        act(() => sockets[0].fire("notification:new", notif(1)));
        fireEvent.click(screen.getByRole("button", { name: m.notifications.dismiss }));
        expect(screen.queryByTestId("notification-toast")).toBeNull();
        act(() => sockets[0].fire("notification:new", notif(2)));
        expect(screen.getAllByTestId("notification-toast")).toHaveLength(1);
        act(() => { vi.advanceTimersByTime(6100); });
        expect(screen.queryByTestId("notification-toast")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe(`NOTIF-03 · notification centre (${locale})`, () => {
    it(`NOTIF-03 · lists newest first in the active locale, marks one as read and opens the related order (${locale})`, async () => {
      login();
      server = [notif(2), notif(1, { readAt: "2026-11-24T07:00:00.000Z" })];
      mockApi();
      wrap(locale, <NotificationsPanel />);
      const rows = await screen.findAllByTestId("notification-row");
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain(locale === "en" ? "Order update 2" : "تحديث الطلب 2");
      expect(rows[0].getAttribute("data-unread")).toBe("true");
      expect(rows[1].getAttribute("data-unread")).toBe("false");
      fireEvent.click(rows[0]);
      await waitFor(() => expect(push).toHaveBeenCalledWith(`/account/orders/${ORDER}`));
      expect(calls.some((c) => c.method === "PATCH" && c.path === `/notifications/${nid(2)}/read`)).toBe(true);
      expect(useNotificationStore.getState().unread).toBe(0);
    });

    it(`NOTIF-03 · an already-read row navigates without a PATCH (${locale})`, async () => {
      login();
      server = [notif(1, { readAt: "2026-11-24T07:00:00.000Z" })];
      mockApi();
      wrap(locale, <NotificationsPanel />);
      fireEvent.click(await screen.findByTestId("notification-row"));
      await waitFor(() => expect(push).toHaveBeenCalled());
      expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    });

    it(`NOTIF-03 · "mark all as read" posts read-all, clears the badge and disables itself (${locale})`, async () => {
      login();
      server = [notif(2), notif(1)];
      mockApi();
      wrap(locale, <><AccountActions /><NotificationsPanel /></>);
      await screen.findAllByTestId("notification-row");
      await act(async () => { await refreshNotifications(); });
      await waitFor(() => expect(screen.getByTestId("notifications-count").textContent).toBe("2"));
      fireEvent.click(screen.getByRole("button", { name: m.notifications.markAllRead }));
      await waitFor(() => expect(screen.queryByTestId("notifications-count")).toBeNull());
      expect(calls.some((c) => c.method === "POST" && c.path === "/notifications/read-all")).toBe(true);
      await waitFor(() =>
        expect((screen.getByRole("button", { name: m.notifications.markAllRead }) as HTMLButtonElement).disabled).toBe(true),
      );
      screen.getAllByTestId("notification-row").forEach((r) => expect(r.getAttribute("data-unread")).toBe("false"));
    });

    it(`NOTIF-03 · paginates 20 per page (${locale})`, async () => {
      login();
      server = Array.from({ length: 25 }, (_, i) => notif(100 - i));
      mockApi();
      wrap(locale, <NotificationsPanel />);
      expect(await screen.findAllByTestId("notification-row")).toHaveLength(20);
      fireEvent.click(screen.getByRole("button", { name: m.notifications.next }));
      await waitFor(() => expect(screen.getAllByTestId("notification-row")).toHaveLength(5));
      expect(calls.some((c) => c.path === "/notifications?page=2&limit=20")).toBe(true);
    });

    it(`NOTIF-03 · empty state and a localized load error with retry, never the API message (${locale})`, async () => {
      login();
      mockApi();
      wrap(locale, <NotificationsPanel />);
      expect(await screen.findByText(m.notifications.empty)).toBeTruthy();
      cleanup();
      mockApi({ failList: true });
      wrap(locale, <NotificationsPanel />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toContain(m.notifications.loadError);
    });

    it(`NOTIF-03 · the account tabs include Notifications and the bell links to it (${locale})`, async () => {
      login();
      mockApi();
      const { AccountShell } = await import("@/components/account/account-shell");
      wrap(locale, <><AccountActions /><AccountShell tab="notifications"><p>x</p></AccountShell></>);
      const tab = within(screen.getByRole("navigation", { name: m.account.title })).getByRole("link", { name: m.account.tabs.notifications });
      expect(tab.getAttribute("href")).toBe("/account/notifications");
      expect(tab.getAttribute("aria-current")).toBe("page");
      expect(screen.getByTestId("notifications-bell").getAttribute("href")).toBe("/account/notifications");
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    });
  });
}
