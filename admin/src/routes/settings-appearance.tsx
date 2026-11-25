import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import {
  previewStyle,
  SWATCHES,
  useApplyTheme,
  useAppearance,
  type ThemePreset,
} from "@/lib/appearance";
import { formatPrice, toLocale } from "@/lib/format";
import { pickText } from "@/lib/products";
import { cn } from "@/lib/utils";

/**
 * ADM-16 (CR-010, ADR-017): Settings > Appearance. Five preset cards, no colour picker. Each card paints
 * its own preview with that preset's variables - scoped to the card, so the dashboard never retints while
 * the owner looks around - and Apply is the only thing that changes the storefront.
 */

const PREVIEW_PRICE = 289_900; // halalas, a plausible sofa: the preview is about colour, not about data

function Swatches({ preset }: { preset: ThemePreset }) {
  const { t } = useTranslation();
  return (
    <ul className="mt-3 flex flex-wrap gap-2" data-testid="theme-swatches">
      {SWATCHES.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-4 rounded-full border border-border"
            style={{ background: preset.tokens[s.token] }}
          />
          {t(`settings.appearance.swatch.${s.key}`)}
        </li>
      ))}
    </ul>
  );
}

/** A product tile, a price and a button, as the storefront paints them in this preset. */
function Preview({ preset }: { preset: ThemePreset }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  return (
    <div
      // The preset's variables live here and nowhere else (ADR-017 decision 8).
      style={previewStyle(preset.tokens)}
      data-testid={`theme-preview-${preset.id}`}
      className="mt-3 rounded-md border border-border bg-background p-3"
    >
      <p className="text-xs text-muted-foreground">{t("settings.appearance.preview.label")}</p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
          <span className="size-6 rounded-full" style={{ background: "var(--gold-strong)" }} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{t("settings.appearance.preview.product")}</p>
          <p className="text-sm font-semibold text-price" dir="ltr">
            {formatPrice(PREVIEW_PRICE, locale)}
          </p>
          <span className="mt-1 inline-block rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            {t("settings.appearance.preview.condition")}
          </span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
          {t("settings.appearance.preview.cta")}
        </span>
        <span aria-hidden="true" className="h-px grow" style={{ background: "var(--champagne)" }} />
      </div>
    </div>
  );
}

export function AppearancePanel() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useAppearance();
  const apply = useApplyTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const active = q.data?.themeId ?? null;
  // Before anything is chosen the applied theme is the selection, so the radiogroup always has one.
  const current = selected ?? active;

  const presets = q.data?.presets ?? [];
  const choose = (id: string) => {
    setSelected(id);
    setApplied(false);
  };
  const move = (from: string, delta: number) => {
    const at = presets.findIndex((p) => p.id === from);
    const next = presets[(at + delta + presets.length) % presets.length];
    if (!next) return;
    choose(next.id);
    refs.current[next.id]?.focus();
  };

  if (q.isPending) {
    return (
      <p role="status" className="mt-3 text-muted-foreground">
        {t("settings.loading")}
      </p>
    );
  }
  if (q.isError) {
    return (
      <div className="mt-3 flex items-center gap-3" data-testid="appearance-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, q.error)}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>
          {t("settings.retry")}
        </Button>
      </div>
    );
  }

  const staleConflict = apply.error instanceof ApiError && apply.error.status === 409;
  const unchanged = current === active;

  return (
    <div className="mt-3">
      <h2 className="text-base font-medium">{t("settings.appearance.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.appearance.intro")}</p>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.appearance.note")}</p>

      <div
        role="radiogroup"
        aria-label={t("settings.appearance.title")}
        className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="theme-cards"
      >
        {presets.map((p) => {
          const isActive = p.id === active;
          const isSelected = p.id === current;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={isSelected}
              // One stop in the tab order for the whole group; the arrows move within it.
              tabIndex={isSelected ? 0 : -1}
              ref={(el) => {
                refs.current[p.id] = el;
              }}
              onClick={() => choose(p.id)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(p.id, 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  move(p.id, -1);
                }
              }}
              data-testid={`theme-card-${p.id}`}
              className={cn(
                "rounded-lg border p-3 text-start",
                isSelected ? "border-primary ring-2 ring-primary/30" : "border-border",
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{pickText(p.name, locale)}</span>
                {isActive && (
                  <span
                    className="rounded-full bg-secondary px-2 py-0.5 text-xs"
                    data-testid={`theme-active-${p.id}`}
                  >
                    {t("settings.appearance.active")}
                  </span>
                )}
                {isSelected && !isActive && (
                  <span className="text-xs text-muted-foreground">
                    {t("settings.appearance.selected")}
                  </span>
                )}
              </span>
              <Swatches preset={p} />
              <Preview preset={p} />
            </button>
          );
        })}
      </div>

      {staleConflict && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="appearance-stale"
        >
          <p>{t("settings.appearance.stale")}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("settings.appearance.reload")}
          </Button>
        </div>
      )}
      {apply.isError && !staleConflict && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="appearance-apply-error">
          {errorMessage(t, locale, apply.error)}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={!current || unchanged || apply.isPending}
          data-testid="theme-apply"
          onClick={() => {
            if (!current || !q.data) return;
            apply.mutate(
              { themeId: current, expectedUpdatedAt: q.data.updatedAt },
              {
                onSuccess: () => {
                  setSelected(null);
                  setApplied(true);
                },
              },
            );
          }}
        >
          {t("settings.appearance.apply")}
        </Button>
        {unchanged && !applied && (
          <p className="text-sm text-muted-foreground" data-testid="theme-unchanged">
            {t("settings.appearance.unchanged")}
          </p>
        )}
        {applied && (
          <p role="status" className="text-sm text-success-foreground" data-testid="theme-applied">
            {t("settings.appearance.applied")}
          </p>
        )}
      </div>
    </div>
  );
}
