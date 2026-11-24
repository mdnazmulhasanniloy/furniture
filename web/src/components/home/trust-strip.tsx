import { getLocale, getTranslations } from "next-intl/server";

import { formatPrice } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import type { SiteSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";

/**
 * A strip of facts the data supports and nothing else (CR-009 section 9, owner Q-2): cash on delivery, the ACTIVE
 * delivery cities by name, and free delivery only when a threshold is set. No ratings, reviews, warranty or returns.
 */
export async function TrustStrip({ settings }: { settings: SiteSettings | null }) {
  const t = await getTranslations("home.trust");
  const locale = (await getLocale()) as Locale;
  const cities = (settings?.deliveryCities ?? [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => pick(c.name, locale) || c.code);
  const threshold = settings?.freeDeliveryThreshold;
  const facts = [
    t("cod"),
    ...(cities.length > 0 ? [t("cities", { cities: new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(cities) })] : []),
    ...(typeof threshold === "number" && threshold > 0 ? [t("freeDelivery", { amount: formatPrice(threshold, locale) })] : []),
  ];
  return (
    <section data-testid="trust-strip" className="band-fill bg-blush text-blush-foreground">
      <ul className="container-wide grid gap-6 md:grid-cols-3">
        {facts.map((f) => (
          <li key={f} className="border-t-2 border-champagne pt-4 text-lg font-medium">
            {f}
          </li>
        ))}
      </ul>
    </section>
  );
}
