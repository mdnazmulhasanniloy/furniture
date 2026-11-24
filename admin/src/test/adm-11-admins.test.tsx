import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import type { AdminUser } from "@/lib/admins";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

const admin = (o: Partial<AdminUser> = {}): AdminUser => ({
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
  createdAt: "2026-11-01T09:00:00.000Z",
  invitedById: null,
  ...o,
});

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[] = [];
let rows: AdminUser[] = [];
/** The signed-in admin (A4 needs a case where the viewer is not the row). */
let me: AdminUser = admin();
let failNext: { status: number; code: string } | null = null;

function stubApi() {
  calls = [];
  failNext = null;
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      const method = init?.method ?? "GET";
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh") return json({ accessToken: "at-1", user: me });
      if (path.startsWith("/admin/admins")) {
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ method, path, body });
        if (method !== "GET" && failNext) {
          const f = failNext;
          failNext = null;
          return json({ code: f.code, message: "Raw English API text" }, f.status);
        }
        if (method === "GET") return json(rows);
        if (method === "POST" && path === "/admin/admins") {
          const created = admin({ id: "u9", ...body, isVerified: false, invitedById: "u1" } as Partial<AdminUser>);
          rows = [created, ...rows];
          return json(created, 201);
        }
        if (method === "POST") return json({ message: "ok" });
        if (method === "PATCH") {
          const id = path.split("/")[3];
          rows = rows.map((r) => (r.id === id ? { ...r, isBlocked: body!.isBlocked as boolean } : r));
          return json(rows.find((r) => r.id === id));
        }
      }
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/admins"]}>
          <App queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => configureApiClient(null));

const writes = () => calls.filter((c) => c.method !== "GET");
const rowOf = (rs: HTMLElement[], name: string) => rs.find((r) => r.textContent?.includes(name))!;

describe.each([
  ["en", en],
  ["ar", ar],
] as const)("ADM-11 · admin users (%s)", (locale, msgs) => {
  beforeEach(async () => {
    initI18n(locale as Locale);
    await setLocale(locale as Locale);
    localStorage.removeItem(THEME_KEY);
    me = admin();
    rows = [
      admin(),
      admin({ id: "u2", firstName: "Omar", lastName: "Pending", email: "omar@furnixa.test", isVerified: false, invitedById: "u1" }),
      admin({ id: "u3", firstName: "Lina", lastName: "Blocked", email: "lina@furnixa.test", isBlocked: true, invitedById: "u1" }),
    ];
    stubApi();
  });

  it("ADM-11 · lists admins with verified/pending/blocked state and who invited whom", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    expect(rs).toHaveLength(3);
    expect(within(rowOf(rs, "Sara")).getByTestId("admin-state").textContent).toBe(msgs.admins.state.active);
    expect(within(rowOf(rs, "Sara")).getByTestId("admin-invited-by").textContent).toBe("—");
    expect(within(rowOf(rs, "Omar")).getByTestId("admin-state").textContent).toBe(msgs.admins.state.pending);
    expect(within(rowOf(rs, "Omar")).getByTestId("admin-invited-by").textContent).toBe("Sara Admin");
    expect(within(rowOf(rs, "Lina")).getByTestId("admin-state").textContent).toBe(msgs.admins.state.blocked);
  });

  it("ADM-11 · invite form has no password, defaults to ar, validates, and posts the invite", async () => {
    mount();
    await screen.findAllByTestId("admin-row");
    fireEvent.click(screen.getByTestId("admin-invite-open"));
    const dlg = await screen.findByTestId("admin-invite-dialog");
    expect(within(dlg).queryByLabelText(/password|كلمة/i)).toBeNull();
    expect((within(dlg).getByLabelText(msgs.admins.form.locale) as HTMLSelectElement).value).toBe("ar");
    fireEvent.click(screen.getByTestId("admin-invite-submit"));
    expect(await within(dlg).findAllByText(msgs.admins.form.errors.required)).toHaveLength(2);
    expect(writes()).toHaveLength(0);
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.firstName), { target: { value: "Nora" } });
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.lastName), { target: { value: "New" } });
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.email), { target: { value: "bad" } });
    fireEvent.click(screen.getByTestId("admin-invite-submit"));
    expect(await within(dlg).findByText(msgs.admins.form.errors.invalidEmail)).toBeTruthy();
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.email), { target: { value: "nora@furnixa.test" } });
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.locale), { target: { value: "en" } });
    fireEvent.click(screen.getByTestId("admin-invite-submit"));
    await waitFor(() => expect(screen.queryByTestId("admin-invite-dialog")).toBeNull());
    expect(writes()[0]).toEqual({
      method: "POST",
      path: "/admin/admins",
      body: { firstName: "Nora", lastName: "New", email: "nora@furnixa.test", preferredLocale: "en" },
    });
    expect(screen.getByTestId("admins-notice-ok").textContent).toBe(msgs.admins.invited);
    expect(await screen.findAllByTestId("admin-row")).toHaveLength(4);
  });

  it("ADM-11 · inviting an existing email shows the localized EMAIL_IN_USE, never the API text", async () => {
    mount();
    await screen.findAllByTestId("admin-row");
    fireEvent.click(screen.getByTestId("admin-invite-open"));
    const dlg = await screen.findByTestId("admin-invite-dialog");
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.firstName), { target: { value: "A" } });
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.lastName), { target: { value: "B" } });
    fireEvent.change(within(dlg).getByLabelText(msgs.admins.form.email), { target: { value: "sara@furnixa.test" } });
    failNext = { status: 409, code: "EMAIL_IN_USE" };
    fireEvent.click(screen.getByTestId("admin-invite-submit"));
    expect((await screen.findByTestId("admin-invite-error")).textContent).toBe(msgs.errors.EMAIL_IN_USE);
    expect(document.body.textContent).not.toContain("Raw English API text");
  });

  it("ADM-11 · only pending rows offer Resend invite; it posts and confirms", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    expect(within(rowOf(rs, "Sara")).queryByTestId("admin-resend")).toBeNull();
    fireEvent.click(within(rowOf(rs, "Omar")).getByTestId("admin-resend"));
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: "POST", path: "/admin/admins/u2/resend-invite" }));
    expect((await screen.findByTestId("admins-notice-ok")).textContent).toContain("omar@furnixa.test");
  });

  it("ADM-11 · resend on an already accepted invite shows ALREADY_VERIFIED and refreshes the row", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    rows = rows.map((r) => (r.id === "u2" ? { ...r, isVerified: true } : r));
    failNext = { status: 409, code: "ALREADY_VERIFIED" };
    fireEvent.click(within(rowOf(rs, "Omar")).getByTestId("admin-resend"));
    expect((await screen.findByTestId("admins-notice-error")).textContent).toBe(msgs.errors.ALREADY_VERIFIED);
    await waitFor(() =>
      expect(within(rowOf(screen.getAllByTestId("admin-row"), "Omar")).getByTestId("admin-state").textContent).toBe(msgs.admins.state.active),
    );
    expect(within(rowOf(screen.getAllByTestId("admin-row"), "Omar")).queryByTestId("admin-resend")).toBeNull();
  });

  it("ADM-11 · blocking asks for confirmation then sends isBlocked true; unblock needs none", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    fireEvent.click(within(rowOf(rs, "Omar")).getByTestId("admin-block"));
    expect(writes()).toHaveLength(0);
    fireEvent.click(await screen.findByTestId("admin-block-confirm"));
    await waitFor(() => expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/admin/admins/u2/block", body: { isBlocked: true } }));
    await waitFor(() =>
      expect(within(rowOf(screen.getAllByTestId("admin-row"), "Omar")).getByTestId("admin-state").textContent).toBe(msgs.admins.state.blocked),
    );
    fireEvent.click(within(rowOf(screen.getAllByTestId("admin-row"), "Lina")).getByTestId("admin-unblock"));
    await waitFor(() => expect(writes()[1]).toMatchObject({ path: "/admin/admins/u3/block", body: { isBlocked: false } }));
  });

  it.each([
    ["SELF_BLOCK", 422],
    ["LAST_ADMIN", 409],
  ])("ADM-11 · block error %s is localized by code", async (code, status) => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    // Omar, not the signed-in Sara: her own Block is disabled since A4, and the API can still answer
    // either code for anyone else (a concurrent block elsewhere).
    fireEvent.click(within(rowOf(rs, "Omar")).getByTestId("admin-block"));
    failNext = { status, code };
    fireEvent.click(await screen.findByTestId("admin-block-confirm"));
    expect((await screen.findByTestId("admins-notice-error")).textContent).toBe(msgs.errors[code as "SELF_BLOCK" | "LAST_ADMIN"]);
    expect(document.body.textContent).not.toContain("Raw English API text");
    expect(screen.queryByTestId("admin-block-dialog")).toBeNull();
  });

  /**
   * QA 2026-11-24 (A4). The page offered Block on every row, the signed-in admin's own included, and
   * only the API refusal (422 SELF_BLOCK / 409 LAST_ADMIN) stopped it. The action is now disabled with
   * the reason next to it; the API guards stay the authority (admin CLAUDE.md rule 5).
   */
  const blockBtn = (row: HTMLElement) => within(row).getByTestId("admin-block") as HTMLButtonElement;

  it("ADM-11 · the signed-in admin cannot block themselves: disabled with the reason (A4)", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    const mine = rowOf(rs, "Sara");
    expect(blockBtn(mine).disabled).toBe(true);
    expect(within(mine).getByTestId("admin-block-why").textContent).toBe(msgs.errors.SELF_BLOCK);
    expect(blockBtn(mine).getAttribute("aria-describedby")).toBe(within(mine).getByTestId("admin-block-why").id);
    fireEvent.click(blockBtn(mine));
    expect(screen.queryByTestId("admin-block-dialog")).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-11 · another admin's row stays blockable (A4)", async () => {
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    const other = rowOf(rs, "Omar");
    expect(blockBtn(other).disabled).toBe(false);
    expect(within(other).queryByTestId("admin-block-why")).toBeNull();
    fireEvent.click(blockBtn(other));
    expect(screen.getByTestId("admin-block-dialog")).toBeTruthy();
  });

  it("ADM-11 · the last active admin cannot be blocked: disabled with the reason (A4)", async () => {
    me = admin({ id: "u9", firstName: "Nora", lastName: "Owner", email: "nora@furnixa.test" }); // not in the list
    mount();
    const rs = await screen.findAllByTestId("admin-row");
    const last = rowOf(rs, "Sara"); // the only verified, unblocked admin in the list
    expect(blockBtn(last).disabled).toBe(true);
    expect(within(last).getByTestId("admin-block-why").textContent).toBe(msgs.errors.LAST_ADMIN);
    // a pending invite does not count as active, and a blocked admin can always be unblocked
    expect(blockBtn(rowOf(rs, "Omar")).disabled).toBe(false);
    expect(within(rowOf(rs, "Lina")).getByTestId("admin-unblock")).toBeTruthy();
    expect(writes()).toHaveLength(0);
  });

  it("ADM-11 · RTL direction and dark mode render the list", async () => {
    document.documentElement.classList.add("dark");
    mount();
    await screen.findAllByTestId("admin-row");
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(msgs.admins.title);
  });
});
