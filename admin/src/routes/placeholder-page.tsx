import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { NAV } from "./shell";

/** Stand-in for sections that later tasks (T-062..T-074) fill in. */
export function PlaceholderPage() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const item = NAV.find((n) => n.path === pathname);
  return (
    <section>
      <h1 className="font-display text-2xl font-semibold">{item ? t(`nav.${item.key}`) : t("shell.notFound")}</h1>
      <p className="mt-2 text-muted-foreground">{item ? t("app.subtitle") : t("shell.notFoundHint")}</p>
    </section>
  );
}
