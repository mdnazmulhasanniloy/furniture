import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { AdminOrder } from "@/lib/orders";

// api-spec.yaml /admin/customers (ADM-05). Personal data is shown exactly as the API returns it.
export type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "ADMIN" | "CUSTOMER";
  phone?: string | null;
  isVerified: boolean;
  isBlocked: boolean;
  preferredLocale: "ar" | "en";
  createdAt?: string;
  orderCount?: number;
};
type Meta = { page: number; limit: number; total: number; totalPages: number };
export type CustomerPage = { items: Customer[]; meta: Meta };
export type CustomerDetail = { user: Customer; orders: AdminOrder[]; meta: Meta };

export const CUSTOMER_PAGE_SIZE = 20;
const KEY = ["admin", "customers"] as const;

export function useCustomers(q: string, page: number) {
  const qs = new URLSearchParams({ page: String(page), limit: String(CUSTOMER_PAGE_SIZE) });
  if (q.trim()) qs.set("q", q.trim().slice(0, 100));
  return useQuery({
    queryKey: [...KEY, "list", qs.toString()],
    queryFn: ({ signal }) => api.get<CustomerPage>(`/admin/customers?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: string | undefined, page: number) {
  const qs = new URLSearchParams({ page: String(page), limit: String(CUSTOMER_PAGE_SIZE) });
  return useQuery({
    queryKey: [...KEY, "one", id, page],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<CustomerDetail>(`/admin/customers/${encodeURIComponent(id!)}?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useBlockCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isBlocked: boolean) =>
      api.patch<Customer>(`/admin/customers/${encodeURIComponent(id)}/block`, { isBlocked }),
    // The call is idempotent; refetch so the page always shows what the server holds.
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}
