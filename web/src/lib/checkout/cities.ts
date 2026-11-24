import type { CityOption } from "@/components/checkout/address-form";
import type { LocalizedText } from "@/lib/pick";

type SettingsCities =
  | { deliveryCities?: { code: string; name?: LocalizedText | null; isActive?: boolean; sortOrder?: number }[] | null }
  | null
  | undefined;

/** Active delivery cities only, in the admin's order (ADR-008); the API re-checks on every write. */
export function activeCities(settings: SettingsCities): CityOption[] {
  return (settings?.deliveryCities ?? [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => ({ code: c.code, name: c.name ?? { en: c.code } }));
}
