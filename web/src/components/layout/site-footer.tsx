import { getLocale, getTranslations } from "next-intl/server";

import { LanguageSwitcher } from "@/components/language-switcher";
import { Link } from "@/i18n/navigation";
import type { SiteSettings } from "@/lib/api/public";
import { pick } from "@/lib/pick";

const SOCIALS = ["facebook", "instagram", "whatsapp", "tiktok"] as const;

/** Admin-entered social URLs are only rendered when they are valid https URLs. */
export function safeHttps(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

const linkCls = "underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

/** One emerald block (ADR-015): contact, cities served, cash on delivery in one sentence, language switch. */
export async function SiteFooter({ settings }: { settings: SiteSettings | null }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const address = pick(settings?.address, locale);
  const socials = SOCIALS.flatMap((key) => {
    const href = safeHttps(settings?.socials?.[key]);
    return href ? [{ key, href }] : [];
  });
  const cities = (settings?.deliveryCities ?? [])
    .filter((c) => c.isActive !== false)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((c) => pick(c.name, locale) || c.code);

  return (
    <footer className="mt-20 bg-primary text-secondary">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr] md:px-8">
        <div>
          <p className="font-display text-2xl font-semibold">{t("home.brand")}</p>
          <p className="measure mt-3 max-w-xs text-sm">{t("footer.about")}</p>
          <p data-testid="footer-cod" className="mt-4 max-w-xs text-sm">
            {t("footer.cod")}
          </p>
        </div>
        <div>
          <h2 className="font-display text-sm font-semibold">{t("footer.contact")}</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {settings?.contactEmail && (
              <li>
                <a href={`mailto:${settings.contactEmail}`} className={linkCls}>
                  {settings.contactEmail}
                </a>
              </li>
            )}
            {settings?.contactPhone && (
              <li>
                <a href={`tel:${settings.contactPhone}`} dir="ltr" className={linkCls}>
                  {settings.contactPhone}
                </a>
              </li>
            )}
            {address && <li>{address}</li>}
          </ul>
          {socials.length > 0 && (
            <ul aria-label={t("footer.social")} className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {socials.map(({ key, href }) => (
                <li key={key}>
                  <a href={href} rel="noopener noreferrer" target="_blank" className={linkCls}>
                    {t(`footer.socials.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="font-display text-sm font-semibold">{t("footer.cities")}</h2>
          <ul data-testid="footer-cities" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {cities.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="font-display text-sm font-semibold">{t("footer.explore")}</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>
              <Link href="/shop" className={linkCls}>{t("nav.shop")}</Link>
            </li>
            <li>
              <Link href="/shop?type=new" className={linkCls}>{t("nav.new")}</Link>
            </li>
            <li>
              <Link href="/shop?type=resale" className={linkCls}>{t("nav.resale")}</Link>
            </li>
          </ul>
          <div className="mt-5">
            <LanguageSwitcher
              testId="footer-language-switcher"
              className="border-secondary bg-primary text-secondary hover:bg-primary hover:underline hover:text-secondary"
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
