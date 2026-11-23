import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import {
  useDashboardSummary,
  type DashboardSummary,
} from "@/lib/dashboard";
import {
  formatDateTime,
  formatDay,
  formatNumber,
  formatPrice,
  toLocale,
} from "@/lib/format";
import { STATUS_CLASS } from "@/lib/orders";
import { cn } from "@/lib/utils";

function Kpi({
  label,
  hint,
  value,
  testId,
}: {
  label: string;
  hint?: string;
  value: ReactNode;
  testId: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-[var(--shadow-soft)]">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className="mt-1 font-display text-3xl font-semibold"
        data-testid={testId}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OrdersChart({ data }: { data: DashboardSummary["ordersByDay"] }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-labelledby="ov-chart-title"
    >
      <h2 id="ov-chart-title" className="font-display text-lg font-semibold">
        {t("overview.chart.title")}
      </h2>
      <p className="text-xs text-muted-foreground">
        {t("overview.chart.subtitle")}
      </p>
      {/* Time runs left to right in both directions; the box is forced LTR so Recharts keeps one orientation. */}
      <div
        dir="ltr"
        className="mt-3 h-64 w-full"
        role="img"
        aria-label={t("overview.chart.summary")}
        data-testid="orders-chart"
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 640, height: 256 }}>
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={(d: string) => formatDay(d, locale)}
              stroke="var(--muted-foreground)"
              fontSize={12}
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--muted-foreground)"
              fontSize={12}
              tickFormatter={(n: number) => formatNumber(n, locale)}
              width={32}
            />
            <Tooltip
              labelFormatter={(d) => formatDay(String(d), locale)}
              formatter={(v) => [
                formatNumber(Number(v), locale),
                t("overview.chart.orders"),
              ]}
              contentStyle={{
                background: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {/* Text alternative for the chart (screen readers). */}
      <table className="sr-only" data-testid="orders-chart-table">
        <caption>{t("overview.chart.tableCaption")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("overview.chart.date")}</th>
            <th scope="col">{t("overview.chart.orders")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatDay(d.date, locale)}</th>
              <td>{formatNumber(d.count, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LatestOrders({
  orders,
}: {
  orders: DashboardSummary["latestOrders"];
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  return (
    <section
      className="rounded-lg border border-border bg-card p-4"
      aria-labelledby="ov-latest-title"
    >
      <h2 id="ov-latest-title" className="font-display text-lg font-semibold">
        {t("overview.latest.title")}
      </h2>
      {orders.length === 0 ? (
        <p
          className="mt-3 text-sm text-muted-foreground"
          data-testid="latest-empty"
        >
          {t("overview.latest.empty")}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm" data-testid="latest-orders">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(
                  ["order", "customer", "status", "total", "placed"] as const
                ).map((k) => (
                  <th
                    key={k}
                    scope="col"
                    className="px-2 py-2 text-start font-medium"
                  >
                    {t(`overview.latest.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="border-t border-border"
                  data-testid="latest-order-row"
                >
                  <td className="px-2 py-2 text-start font-medium">
                    <Link
                      to={`/orders/${encodeURIComponent(o.id)}`}
                      className="text-primary underline-offset-2 hover:underline"
                      data-testid="latest-order-link"
                    >
                      <bdi dir="ltr">{o.orderNo}</bdi>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-start">
                    {o.user ? `${o.user.firstName} ${o.user.lastName}` : "—"}
                  </td>
                  <td className="px-2 py-2 text-start">
                    <span
                      className={cn(
                        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                        STATUS_CLASS[o.status],
                      )}
                    >
                      {t(`orders.status.${o.status}`)}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-start">
                    <bdi>{formatPrice(o.total, locale)}</bdi>
                  </td>
                  <td className="px-2 py-2 text-start text-muted-foreground">
                    {formatDateTime(o.createdAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OverviewPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useDashboardSummary();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold">
        {t("overview.title")}
      </h1>
      {q.isPending && (
        <p role="status" className="text-muted-foreground">
          {t("overview.loading")}
        </p>
      )}
      {q.isError && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-md border border-destructive/40 p-3 text-destructive"
        >
          <span data-testid="overview-error">
            {errorMessage(t, i18n.language, q.error)}
          </span>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("overview.retry")}
          </Button>
        </div>
      )}
      {q.data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={t("overview.kpi.todayOrders")}
              value={formatNumber(q.data.todayOrders, locale)}
              testId="kpi-today"
            />
            <Kpi
              label={t("overview.kpi.pendingOrders")}
              value={formatNumber(q.data.pendingOrders, locale)}
              testId="kpi-pending"
            />
            <Kpi
              label={t("overview.kpi.monthRevenue")}
              hint={t("overview.kpi.monthRevenueHint")}
              value={<bdi>{formatPrice(q.data.monthRevenue, locale)}</bdi>}
              testId="kpi-revenue"
            />
            <Kpi
              label={t("overview.kpi.lowStock")}
              hint={t("overview.kpi.lowStockHint")}
              value={formatNumber(q.data.lowStockCount, locale)}
              testId="kpi-low-stock"
            />
          </div>
          <OrdersChart data={q.data.ordersByDay} />
          <LatestOrders orders={q.data.latestOrders} />
        </>
      )}
    </div>
  );
}
