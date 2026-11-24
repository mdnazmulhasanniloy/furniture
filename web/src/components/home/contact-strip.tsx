import { Mail, MessageCircle, Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { PhoneText } from "@/components/format";
import type { SiteSettings } from "@/lib/api/public";
import { safeHref } from "@/lib/home";

/**
 * Contact strip (owner 2026-11-24, CR-007 Q-6): email, phone and WhatsApp from Site Settings; no
 * newsletter and no new backend. Hidden when no channel is set. The WhatsApp link must pass `safeHref`
 * and be an absolute https URL.
 */
export function ContactStrip({ settings }: { settings: SiteSettings | null }) {
  const t = useTranslations("home.contact");
  const email = settings?.contactEmail?.trim() || null;
  const phone = settings?.contactPhone?.trim() || null;
  const wa = safeHref(settings?.socials?.whatsapp);
  const whatsapp = wa?.external ? wa.href : null;
  if (!email && !phone && !whatsapp) return null;

  const item = "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";
  return (
    <section
      data-testid="contact-strip"
      data-reveal
      aria-labelledby="contact-strip-title"
      className="bg-primary text-primary-foreground"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 md:flex-row md:items-center md:justify-between">
        <div>
          <span className="mb-3 block h-0.5 w-14 bg-gold" aria-hidden />
          <h2 id="contact-strip-title" className="font-display text-2xl font-semibold">
            {t("title")}
          </h2>
          <p className="mt-1 max-w-md text-sm">{t("text")}</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {email ? (
            <li>
              <a className={item} href={`mailto:${email}`} data-testid="contact-email">
                <Mail className="size-4" aria-hidden />
                <span dir="ltr">{email}</span>
              </a>
            </li>
          ) : null}
          {phone ? (
            <li>
              <a className={item} href={`tel:${phone.replace(/[^\d+]/g, "")}`} data-testid="contact-phone">
                <Phone className="size-4" aria-hidden />
                <PhoneText value={phone} />
              </a>
            </li>
          ) : null}
          {whatsapp ? (
            <li>
              <a className={item} href={whatsapp} target="_blank" rel="noopener noreferrer" data-testid="contact-whatsapp">
                <MessageCircle className="size-4" aria-hidden />
                {t("whatsapp")}
              </a>
            </li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
