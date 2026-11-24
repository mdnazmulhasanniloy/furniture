import { apiRequest } from "@/lib/api/client";
import type { AuthUser } from "@/lib/auth/store";
import type { Address, AddressInput, Order } from "@/lib/checkout/api";

// Account API calls (PROF-01, PROF-02, ORD-02, ORD-03). Shapes follow api-spec.yaml
// (#/me, #/me/addresses, #/orders). Amounts are halalas, shown exactly as returned.

export type ProfilePatch = {
  firstName?: string;
  lastName?: string;
  phone?: string | null;
  preferredLocale?: "ar" | "en";
};

export const updateProfile = (patch: ProfilePatch) =>
  apiRequest<AuthUser>("/me", { method: "PATCH", body: patch });

export type AddressPatch = Partial<AddressInput> & { isDefault?: boolean };

export const updateAddress = (id: string, patch: AddressPatch) =>
  apiRequest<Address>(`/me/addresses/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });

export const deleteAddress = (id: string) =>
  apiRequest<void>(`/me/addresses/${encodeURIComponent(id)}`, { method: "DELETE" });

export type StatusEvent = { status: string; at: string };

/** `GET /orders/{id}` as seen by the customer (statusHistory carries only `{status, at}`). */
export type AccountOrder = Order & {
  paymentStatus?: "UNPAID" | "PAID";
  statusHistory?: StatusEvent[];
  customerNote?: string | null;
  createdAt?: string;
  address: Order["address"] & { notes?: string | null };
};

export type OrderPage = {
  items: AccountOrder[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};

export const listOrders = (page = 1, limit = 10) =>
  apiRequest<OrderPage>(`/orders?page=${page}&limit=${limit}`);

export const getOrder = (id: string) =>
  apiRequest<AccountOrder>(`/orders/${encodeURIComponent(id)}`);

/** ORD-03: only a PENDING order can be cancelled; the API answers 409 INVALID_TRANSITION otherwise. */
export const cancelOrder = (id: string) =>
  apiRequest<AccountOrder>(`/orders/${encodeURIComponent(id)}/cancel`, { method: "POST" });
