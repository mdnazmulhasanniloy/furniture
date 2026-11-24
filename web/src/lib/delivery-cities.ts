import type { SiteSettings } from "@/lib/api/public";

/** Number of active delivery cities from the public settings (the API already lists active cities only). */
export function activeCityCount(settings: SiteSettings | null): number {
  return settings?.deliveryCities?.filter((c) => c.isActive !== false).length ?? 0;
}
