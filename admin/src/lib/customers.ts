import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import type { AdminOrder } from "@/lib/orders";

// api-spec.yaml /admin/customers (ADM-05, ADM-17). Personal data is shown exactly as the API returns it.
// The admin never sets or sees a password; the blocked reason is admin-only (never shown to the customer).
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
  updatedAt?: string;
  orderCount?: number;
  blockedReason?: string | null;
  blockedAt?: string | null;
  blockedById?: string | null;
  deletedAt?: string | null;
  deletedById?: string | null;
};
type Meta = { page: number; limit: number; total: number; totalPages: number };
export type CustomerPage = { items: Customer[]; meta: Meta };
export type CustomerDetail = { user: Customer; orders: AdminOrder[]; meta: Meta };
export type CustomerStatus = "active" | "blocked" | "deleted";

export const CUSTOMER_PAGE_SIZE = 20;
const KEY = ["admin", "customers"] as const;

export const customerState = (c: Pick<Customer, "isBlocked" | "deletedAt">): CustomerStatus =>
  c.deletedAt ? "deleted" : c.isBlocked ? "blocked" : "active";

export function useCustomers(q: string, page: number, status?: CustomerStatus) {
  const qs = new URLSearchParams({ page: String(page), limit: String(CUSTOMER_PAGE_SIZE) });
  if (q.trim()) qs.set("q", q.trim().slice(0, 100));
  if (status) qs.set("status", status);
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

/** Block needs a reason of 3 to 300 characters (CR-011); unblock sends none. */
export function useBlockCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { isBlocked: true; reason: string } | { isBlocked: false }) =>
      api.patch<Customer>(`/admin/customers/${encodeURIComponent(id)}/block`, v),
    // The call is idempotent; refetch so the page always shows what the server holds.
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

export type CustomerEdit = { expectedUpdatedAt: string; firstName?: string; lastName?: string; phone?: string | null };

/** Name and phone only (the API rejects every other field). */
export function useUpdateCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CustomerEdit) => api.patch<Customer>(`/admin/customers/${encodeURIComponent(id)}`, body),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Soft delete with anonymisation; the API compares `confirmEmail` with the stored email again. */
export function useDeleteCustomer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (confirmEmail: string) => api.deleteBody<Customer>(`/admin/customers/${encodeURIComponent(id)}`, { confirmEmail }),
    onSettled: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Mirrors the API's Saudi mobile rule (api-spec SaudiPhoneInput): +966 / 00966 / 0 / none, then 5 and 8 digits. */
export function isSaudiMobile(input: string): boolean {
  const cleaned = input.trim().replace(/[\s\-.()]/g, "");
  return /^(\+966|00966|0)?5[0-9]{8}$/.test(cleaned);
}
