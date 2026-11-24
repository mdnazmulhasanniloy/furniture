import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { api } from "@/lib/api/client";
import type { OrderStatus } from "@/lib/dashboard";

export type { OrderStatus };

// api-spec.yaml /admin/orders (ADM-04). Money fields are integer halalas, shown exactly as the
// order snapshot returns them: nothing here computes a total, a fee or VAT.
export type LocalizedText = { en: string; ar: string };
export type OrderVat = {
  vatRate: number;
  vatAmount: number;
  applyToDelivery: boolean;
  pricesIncludeVat: boolean;
  registrationNumber?: string | null;
};
export type OrderItem = {
  productId: string;
  titleSnapshot: LocalizedText;
  sku?: string | null;
  imageSnapshot?: string | null;
  unitPrice: number;
  qty: number;
  lineTotal: number;
  type?: string;
  condition?: string;
};
export type OrderAddress = {
  fullName: string;
  phone: string;
  cityCode?: string;
  city: LocalizedText;
  area: string;
  street: string;
  notes?: string | null;
};
export type StatusEvent = { status: OrderStatus; at: string; byUserId?: string; note?: string | null };
export type AdminOrder = {
  id: string;
  orderNo: string;
  user?: { id: string; firstName: string; lastName: string; email: string };
  items: OrderItem[];
  address: OrderAddress;
  subtotal: number;
  deliveryFee: number;
  vat: OrderVat;
  total: number;
  currency: "SAR";
  paymentMethod: "COD";
  paymentStatus: "UNPAID" | "PAID";
  status: OrderStatus;
  statusHistory: StatusEvent[];
  customerNote?: string | null;
  adminNote?: string | null;
  createdAt: string;
};
export type OrderPage = {
  items: AdminOrder[];
  meta: { page: number; limit: number; total: number; totalPages: number };
};
export type OrderQuery = { status: "" | OrderStatus; q: string; from: string; to: string; page: number };

export const ORDER_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
];

/** Transition matrix from api-spec PATCH /admin/orders/{id}/status (owner 2026-11-22, T-014). The backend stays the authority. */
export const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["OUT_FOR_DELIVERY", "CANCELLED"],
  OUT_FOR_DELIVERY: ["DELIVERED", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

// Status colours per design-system §1 (tokens only).
export const STATUS_CLASS: Record<OrderStatus, string> = {
  PENDING: "bg-warning/15 text-warning-foreground",
  CONFIRMED: "bg-primary/15 text-primary",
  PROCESSING: "bg-gold/20 text-foreground",
  OUT_FOR_DELIVERY: "bg-secondary text-secondary-foreground",
  DELIVERED: "bg-success/15 text-success-foreground",
  CANCELLED: "bg-destructive/10 text-destructive",
};

export const PAGE_SIZE = 20;
const KEY = ["admin", "orders"] as const;

export function useOrders(p: OrderQuery) {
  const qs = new URLSearchParams({ page: String(p.page), limit: String(PAGE_SIZE) });
  if (p.status) qs.set("status", p.status);
  if (p.q.trim()) qs.set("q", p.q.trim().slice(0, 100));
  if (p.from) qs.set("from", p.from);
  if (p.to) qs.set("to", p.to);
  return useQuery({
    queryKey: [...KEY, "list", qs.toString()],
    queryFn: ({ signal }) => api.get<OrderPage>(`/admin/orders?${qs}`, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: [...KEY, "one", id],
    enabled: !!id,
    queryFn: ({ signal }) => api.get<AdminOrder>(`/admin/orders/${encodeURIComponent(id!)}`, { signal }),
  });
}

function useOrderWrite<V>(id: string, send: (v: V) => Promise<AdminOrder>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (order) => {
      qc.setQueryData([...KEY, "one", id], order);
      void qc.invalidateQueries({ queryKey: [...KEY, "list"] });
      void qc.invalidateQueries({ queryKey: ["admin", "dashboard"] });
    },
    // 409 INVALID_TRANSITION means another admin got there first: reload the order.
    onError: () => void qc.invalidateQueries({ queryKey: [...KEY, "one", id] }),
  });
}

export function useChangeStatus(id: string) {
  return useOrderWrite(id, (v: { status: OrderStatus; note?: string }) =>
    api.patch<AdminOrder>(`/admin/orders/${encodeURIComponent(id)}/status`, v),
  );
}

export function useSaveNote(id: string) {
  return useOrderWrite(id, (adminNote: string | null) =>
    api.patch<AdminOrder>(`/admin/orders/${encodeURIComponent(id)}/note`, { adminNote }),
  );
}

// Cancel reason: trimmed, 3-500 (api-spec). Admin note: trimmed, max 2000.
export const cancelSchema = z.object({
  note: z.string().trim().min(3, "orders.cancel.tooShort").max(500, "orders.cancel.tooLong"),
});
export const NOTE_MAX = 2000;
