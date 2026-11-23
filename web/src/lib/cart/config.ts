import type { SiteSettings } from "@/lib/api/public";

import type { CartConfig } from "./types";

/** Display config from public settings; threshold and overrides come from the API, not computed. */
export function cartConfigFrom(settings: SiteSettings | null): CartConfig {
  return {
    freeDeliveryThreshold: settings?.freeDeliveryThreshold ?? null,
    hasCityFeeOverride: !!settings?.deliveryCities?.some((c) => typeof c.deliveryFee === "number"),
  };
}
