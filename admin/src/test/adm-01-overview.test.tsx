import { render, screen, within } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "@/app";
import { configureApiClient } from "@/lib/api/client";
import { authStore } from "@/lib/auth/store";
import { initI18n, setLocale, type Locale } from "@/lib/i18n";
import { THEME_KEY, ThemeProvider } from "@/lib/theme";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

const adminUser = {
  id: "u1",
  firstName: "Sara",
  lastName: "Admin",
  email: "sara@furnixa.test",
  role: "ADMIN",
  isVerified: true,
  isBlocked: false,
  preferredLocale: "ar",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const days = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-11-${String(i < 7 ? 24 + i : i - 6).padStart(2, "0")}`,
  count: i === 29 ? 3 : 0,
}));
// Odd halala amounts: shown exactly as returned (halalas / 100, two decimals).
const summary = {
  todayOrders: 3,
  pendingOrders: 7,
  monthRevenue: 3000401,
  lowStockCount: 4,
  ordersByDay: days,
  latestOrders: [
    {
      id: "o1",
      orderNo: "FX-20261123-0003",
      user: {
        id: "c1",
        firstName: "Layla",
        lastName: "Hassan",
        email: "l@x.test",
      },
      total: 12345,
      status: "PENDING",
      createdAt: "2026-11-23T20:30:00.000Z",
    },
    {
      id: "o2",
      orderNo: "FX-20261123-0002",
      user: {
        id: "c2",
        firstName: "Omar",
        lastName: "Said",
        email: "o@x.test",
      },
      total: 50000,
      status: "DELIVERED",
      createdAt: "2026-11-23T08:00:00.000Z",
    },
  ],
};

let paths: string[] = [];
function stubApi(onSummary: () => Response) {
  paths = [];
  configureApiClient({
    getLocale: () => document.documentElement.lang,
    fetch: (async (url: string) => {
      const path = url.replace(/^.*\/api\/v1/, "");
      paths.push(path);
      if (path === "/auth/csrf") return json({ csrfToken: "csrf-1" });
      if (path === "/auth/refresh")
        return json({ accessToken: "at-1", user: adminUser });
      if (path === "/admin/dashboard/summary") return onSummary();
      return json({ code: "NOT_FOUND" }, 404);
    }) as unknown as typeof fetch,
  });
}

function mount() {
  const i18n = initI18n();
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <MemoryRouter initialEntries={["/"]}>
          <App
            queryClient={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          />
        </MemoryRouter>
      </ThemeProvider>
    </I18nextProvider>,
  );
}

async function useLocale(l: Locale) {
  initI18n(l);
  await setLocale(l);
  localStorage.removeItem(THEME_KEY);
}

beforeEach(() => {
  authStore.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => configureApiClient(null));

describe.each([
  ["en", en, "en-SA-u-nu-latn"],
  ["ar", ar, "ar-SA-u-nu-latn"],
] as const)("ADM-01 · overview (%s)", (locale, msgs, tag) => {
  beforeEach(async () => {
    await useLocale(locale);
  });
  const money = (h: number) =>
    new Intl.NumberFormat(tag, {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: h % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(h / 100);

  it("ADM-01 · the four KPI cards show the API values; revenue is the exact halala amount", async () => {
    stubApi(() => json(summary));
    mount();
    expect((await screen.findByTestId("kpi-today")).textContent).toBe("3");
    expect(screen.getByTestId("kpi-pending").textContent).toBe("7");
    expect(screen.getByTestId("kpi-low-stock").textContent).toBe("4");
    // 3000401 halalas = 30,004.01 SAR, no rounding or recomputation.
    expect(screen.getByTestId("kpi-revenue").textContent).toBe(money(3000401));
    expect(screen.getByTestId("kpi-revenue").textContent).toMatch(
      /30[,٬]?004\.01/,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: msgs.overview.title }),
    ).toBeTruthy();
    expect(paths).toContain("/admin/dashboard/summary");
  });

  it("ADM-01 · the 30-day orders chart renders with an accessible text alternative of 30 days", async () => {
    stubApi(() => json(summary));
    mount();
    await screen.findByTestId("kpi-today");
    expect(
      screen.getByRole("img", { name: msgs.overview.chart.summary }),
    ).toBeTruthy();
    const table = screen.getByTestId("orders-chart-table");
    expect(within(table).getAllByRole("row")).toHaveLength(31); // header + 30 days
    expect(screen.getByTestId("orders-chart").getAttribute("dir")).toBe("ltr");
  });

  it("ADM-01 · latest orders table: order number, customer, localized status, exact total, newest first", async () => {
    stubApi(() => json(summary));
    mount();
    await screen.findByTestId("kpi-today");
    const rows = screen.getAllByTestId("latest-order-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("FX-20261123-0003");
    expect(rows[0].textContent).toContain("Layla Hassan");
    expect(rows[0].textContent).toContain(msgs.orders.status.PENDING);
    expect(rows[0].textContent).toContain(money(12345));
    expect(rows[1].textContent).toContain(msgs.orders.status.DELIVERED);
    expect(rows[1].textContent).toContain(money(50000));
  });

  it("ADM-01 · no orders yet shows an empty message instead of a table", async () => {
    stubApi(() => json({ ...summary, latestOrders: [] }));
    mount();
    expect((await screen.findByTestId("latest-empty")).textContent).toBe(
      msgs.overview.latest.empty,
    );
    expect(screen.queryByTestId("latest-orders")).toBeNull();
  });

  it("ADM-01 · an API error shows the localized message by code (never the API text) and can retry", async () => {
    let fail = true;
    stubApi(() =>
      fail
        ? json({ code: "INTERNAL_ERROR", message: "Raw English API text" }, 500)
        : json(summary),
    );
    mount();
    const err = await screen.findByTestId("overview-error");
    expect(err.textContent).toBe(msgs.errors.generic);
    expect(err.textContent).not.toContain("Raw English");
    fail = false;
    screen.getByRole("button", { name: msgs.overview.retry }).click();
    expect((await screen.findByTestId("kpi-today")).textContent).toBe("3");
  });
});

describe("ADM-01 · layout", () => {
  it("ADM-01 · renders in dark mode in Arabic (RTL) using logical, token-based styles", async () => {
    await useLocale("ar");
    localStorage.setItem(THEME_KEY, "dark");
    stubApi(() => json(summary));
    const { container } = mount();
    await screen.findByTestId("kpi-today");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dir).toBe("rtl");
    const html = container.innerHTML;
    expect(html).not.toMatch(
      /class="[^"]*\b(text-left|text-right|ml-\d|mr-\d|pl-\d|pr-\d)\b/,
    );
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
