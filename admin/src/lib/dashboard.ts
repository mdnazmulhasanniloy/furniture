import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";

// api-spec.yaml GET /admin/dashboard/summary (ADM-01). Money fields are integer halalas.
export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export type DashboardOrder = {
  id: string;
  orderNo: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
  total: number;
  status: OrderStatus;
  createdAt: string;
};

export type DashboardSummary = {
  todayOrders: number;
  pendingOrders: number;
  monthRevenue: number;
  lowStockCount: number;
  ordersByDay: { date: string; count: number }[];
  latestOrders: DashboardOrder[];
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: ["admin", "dashboard", "summary"],
    queryFn: ({ signal }) =>
      api.get<DashboardSummary>("/admin/dashboard/summary", { signal }),
  });
}
