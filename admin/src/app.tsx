import { useTranslation } from "react-i18next";
import { Route, Routes } from "react-router";
import { Button } from "@/components/ui/button";
import { setLocale, type Locale } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";

export function Shell() {
  const { t, i18n } = useTranslation();
  const { theme, toggle } = useTheme();
  const next: Locale = i18n.language === "ar" ? "en" : "ar";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <h1 className="font-display text-xl font-semibold">{t("app.title")}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void setLocale(next)} data-testid="locale-toggle">
            {t(next === "ar" ? "common.arabic" : "common.english")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            aria-pressed={theme === "dark"}
            data-testid="theme-toggle"
          >
            {t(theme === "dark" ? "theme.switchToLight" : "theme.switchToDark")}
          </Button>
        </div>
      </header>
      <main className="p-4">
        <p className="text-muted-foreground">{t("app.subtitle")}</p>
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
