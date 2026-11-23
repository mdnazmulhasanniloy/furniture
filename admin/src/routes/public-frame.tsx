import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { setLocale, type Locale } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

/** Language + theme toggles, shared by the public frame and the dashboard top bar. */
export function PreferenceToggles() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const next: Locale = i18n.language === "ar" ? "en" : "ar";
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void setLocale(next)} data-testid="locale-toggle">
        {t(next === "ar" ? "common.arabic" : "common.english")}
      </Button>
      <Button variant="outline" size="sm" onClick={toggle} aria-pressed={theme === "dark"} data-testid="theme-toggle">
        {t(theme === "dark" ? "theme.switchToLight" : "theme.switchToDark")}
      </Button>
    </>
  );
}

/** Frame for pages shown before sign-in (login, accept-invite, session restore). */
export function PublicFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <h1 className="font-display text-xl font-semibold">{t("app.title")}</h1>
        <div className="flex items-center gap-2">
          <PreferenceToggles />
        </div>
      </header>
      <main className="mx-auto flex max-w-md flex-col gap-4 p-4 pt-10">{children}</main>
    </div>
  );
}
