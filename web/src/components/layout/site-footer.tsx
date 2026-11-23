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

export async function SiteFooter({ settings }: { settings: SiteSettings | null }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const address = pick(settings?.address, locale);
  const socials = SOCIALS.flatMap((key) => {
    const href = safeHttps(settings?.socials?.[key]);
    return href ? [{ key, href }] : [];
  });

  return (
    <footer className="mt-16 border-t border-border bg-muted">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 md:grid-cols-3">
        <div>
          <p className="font-display text-xl font-semibold text-primary">{t("home.brand")}</p>
          <p className="mt-2 max-w-xs text-sm text-muted-foreground">{t("footer.about")}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">{t("footer.contact")}</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {settings?.contactEmail && (
              <li>
                <a href={`mailto:${settings.contactEmail}`} className="hover:text-foreground">
                  {settings.contactEmail}
                </a>
              </li>
            )}
            {settings?.contactPhone && (
              <li>
                <a href={`tel:${settings.contactPhone}`} dir="ltr" className="hover:text-foreground">
                  {settings.contactPhone}
                </a>
              </li>
            )}
            {address && <li>{address}</li>}
          </ul>
          {socials.length > 0 && (
            <ul aria-label={t("footer.social")} className="mt-3 flex flex-wrap gap-3 text-sm">
              {socials.map(({ key, href }) => (
                <li key={key}>
                  <a href={href} rel="noopener noreferrer" target="_blank" className="text-primary hover:underline">
                    {t(`footer.socials.${key}`)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{t("footer.explore")}</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <Link href="/shop" className="hover:text-foreground">{t("nav.shop")}</Link>
            </li>
            <li>
              <Link href="/shop?type=resale" className="hover:text-foreground">{t("nav.resale")}</Link>
            </li>
          </ul>
          <div className="mt-4">
            <LanguageSwitcher testId="footer-language-switcher" />
          </div>
        </div>
      </div>
    </footer>
  );
}
