import type { HomeProduct } from "@/lib/api/public";

// Shapes of api-spec.yaml#Cart (CART-01). Money is in halalas, exactly as the API returns it.

export type CartIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "QTY_REDUCED" | "PRICE_CHANGED";

export type ServerCartItem = {
  product: HomeProduct | null;
  qty: number;
  lineTotal: number;
  issue?: CartIssue | null;
  details?: { oldPrice: number; newPrice: number } | null;
};

export type ServerCart = {
  items: ServerCartItem[];
  subtotal: number;
  deliveryFee: number;
  vat?: { vatRate: number; vatAmount: number; applyToDelivery?: boolean; pricesIncludeVat: boolean } | null;
  total: number;
  address?: { id: string; cityCode: string; isDeliverable: boolean } | null;
};

/** Guest cart line persisted in localStorage: ids and quantity only (no prices, no titles). */
export type GuestLine = { productId: string; slug: string; qty: number };

/** Display config derived from public settings (server) and passed to the client. */
export type CartConfig = {
  /** Halalas; null/0 = no threshold, so no progress bar. */
  freeDeliveryThreshold: number | null;
  /** True when any active city has its own fee: the fee is then "confirmed at checkout". */
  hasCityFeeOverride: boolean;
};
