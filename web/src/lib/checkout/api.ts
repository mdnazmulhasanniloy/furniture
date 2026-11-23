import { apiRequest } from "@/lib/api/client";
import type { LocalizedText } from "@/lib/pick";

// Checkout API calls (ORD-01, PROF-02). Shapes follow api-spec.yaml#Address / #Order. Every
// amount is in halalas, exactly as the API returns it.

export type Address = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  cityCode: string;
  area: string;
  street: string;
  notes?: string | null;
  isDefault: boolean;
  isDeliverable: boolean;
};

export type AddressInput = {
  label: string;
  fullName: string;
  phone: string;
  cityCode: string;
  area: string;
  street: string;
  notes?: string;
};

export type Order = {
  id: string;
  orderNo: string;
  items: {
    productId: string;
    titleSnapshot: LocalizedText;
    imageSnapshot?: string | null;
    unitPrice: number;
    qty: number;
    lineTotal: number;
  }[];
  address: {
    fullName: string;
    phone: string;
    cityCode: string;
    city?: LocalizedText | null;
    area: string;
    street: string;
  };
  subtotal: number;
  deliveryFee: number;
  vat?: { vatRate: number; vatAmount: number; applyToDelivery?: boolean; pricesIncludeVat: boolean } | null;
  total: number;
  paymentMethod: "COD";
  status: string;
};

export const listAddresses = () => apiRequest<Address[]>("/me/addresses");

export const createAddress = (input: AddressInput) =>
  apiRequest<Address>("/me/addresses", { method: "POST", body: input });

export const fetchOrder = (id: string) =>
  apiRequest<Order>(`/orders/${encodeURIComponent(id)}`);

/** `POST /orders`: `expectedTotal` is the total (halalas) the customer saw; the key makes retries safe. */
export const placeOrder = (input: { addressId: string; expectedTotal: number }, idempotencyKey: string) =>
  apiRequest<Order>("/orders", {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
  });

function newUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * One Idempotency-Key per checkout attempt (backend T-013): the same key is reused while the
 * request (addressId + expectedTotal) is unchanged, so double clicks and network retries return
 * the same order; any change of the request gets a fresh key (the old key with a changed body
 * is rejected 422 IDEMPOTENCY_MISMATCH).
 */
export function createAttemptKeys() {
  let current: { key: string; addressId: string; expectedTotal: number } | null = null;
  return {
    keyFor(addressId: string, expectedTotal: number): string {
      if (!current || current.addressId !== addressId || current.expectedTotal !== expectedTotal) {
        current = { key: newUuid(), addressId, expectedTotal };
      }
      return current.key;
    },
    /** After success or IDEMPOTENCY_MISMATCH. */
    reset() {
      current = null;
    },
  };
}
