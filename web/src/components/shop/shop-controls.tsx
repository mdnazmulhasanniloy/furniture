"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import type { Category } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import {
  CONDITIONS,
  SORTS,
  type ConditionGrade,
  type ShopFilters,
  shopHref,
  withChange,
} from "@/lib/shop";

const fieldClass =
  "h-10 w-full rounded-sm border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Halalas -> riyal text for the input (the API takes halalas). */
const toRiyal = (h?: number) => (h === undefined ? "" : String(h / 100));
const toHalalas = (v: string): number | undefined => {
  const n = Number(v.trim());
  return v.trim() !== "" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};

/**
 * Filter panel + toolbar (filter button, sort) around the server-rendered results.
 * One panel instance: a sidebar on large screens, a full-screen sheet on mobile.
 */
function ShopFrameInner({
  filters,
  categories,
  locale,
  children,
}: {
  filters: ShopFilters;
  categories: Category[];
  locale: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("shop");
  const tc = useTranslations("condition");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  // Only a sheet below lg; on desktop the aside is static (focus trap would be wrong).
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setSheet(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useDialogA11y(open && sheet, sheetRef);
  const [draft, setDraft] = useState(filters);
  const [min, setMin] = useState(toRiyal(filters.minPrice));
  const [max, setMax] = useState(toRiyal(filters.maxPrice));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleCondition = (c: ConditionGrade) =>
    setDraft((d) => ({
      ...d,
      condition: d.condition.includes(c)
        ? d.condition.filter((x) => x !== c)
        : [...d.condition, c],
    }));

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    router.push(
      shopHref(
        withChange(draft, {
          minPrice: toHalalas(min),
          maxPrice: toHalalas(max),
          material: draft.material?.trim() || undefined,
        }),
      ),
    );
  };

  const sortSelect = (testId: string) => (
    <select
      data-testid={testId}
      aria-label={t("sort.label")}
      className={`${fieldClass} w-auto shrink-0`}
      value={filters.sort}
      onChange={(e) =>
        router.push(shopHref(withChange(filters, { sort: e.target.value as ShopFilters["sort"] })))
      }
    >
      {SORTS.map((s) => (
        <option key={s} value={s}>
          {t(`sort.${s}`)}
        </option>
      ))}
    </select>
  );

  const typeOptions = [
    { id: "all", value: undefined, label: t("type.all") },
    { id: "new", value: "NEW" as const, label: t("type.new") },
    { id: "resale", value: "RESALE" as const, label: t("type.resale") },
  ];

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12">
      {open ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          data-testid="filters-backdrop"
          className="fixed inset-0 z-40 bg-foreground/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside
        ref={sheetRef}
        id="shop-filters"
        aria-label={t("filters")}
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        className={
          open
            ? "fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-lg bg-background p-4 pb-6 shadow-float lg:sticky lg:top-24 lg:z-auto lg:max-h-[calc(100svh-7rem)] lg:self-start lg:overflow-y-auto scroll-subtle lg:rounded-none lg:p-0 lg:pe-2 lg:shadow-none"
            : "hidden lg:sticky lg:top-24 lg:block lg:max-h-[calc(100svh-7rem)] lg:self-start lg:overflow-y-auto scroll-subtle lg:pe-2"
        }
      >
        <div className="mb-4 flex items-center justify-between lg:hidden">
          <h2 className="text-lg font-semibold">{t("filters")}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setOpen(false)}
            aria-label={t("close")}
          >
            <X aria-hidden />
          </Button>
        </div>
        <div className="mb-6 flex items-center justify-between gap-3 text-sm lg:hidden">
          <span className="font-semibold">{t("sort.label")}</span>
          {sortSelect("sort-sheet")}
        </div>
        <form onSubmit={apply} className="space-y-5" aria-label={t("filters")}>
          {categories.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-base font-semibold">{t("category")}</legend>
              <label className="flex items-center gap-2 text-[0.9375rem]">
                <input
                  type="radio"
                  name="category"
                  checked={!draft.category}
                  onChange={() => setDraft((d) => ({ ...d, category: undefined }))}
                />
                {t("allCategories")}
              </label>
              {categories.map((root) => (
                <div key={root.id} className="space-y-2">
                  <label className="flex items-center gap-2 text-[0.9375rem]">
                    <input
                      type="radio"
                      name="category"
                      checked={draft.category === root.slug}
                      onChange={() => setDraft((d) => ({ ...d, category: root.slug }))}
                    />
                    {pick(root.name, locale)}
                  </label>
                  {(root.children ?? []).map((child) => (
                    <label key={child.id} className="ms-6 flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="category"
                        checked={draft.category === child.slug}
                        onChange={() => setDraft((d) => ({ ...d, category: child.slug }))}
                      />
                      {pick(child.name, locale)}
                    </label>
                  ))}
                </div>
              ))}
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-2 text-base font-semibold">{t("type.label")}</legend>
            {typeOptions.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-[0.9375rem]">
                <input
                  type="radio"
                  name="type"
                  checked={draft.type === o.value}
                  onChange={() => setDraft((d) => ({ ...d, type: o.value }))}
                />
                {o.label}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-base font-semibold">{t("condition")}</legend>
            {CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-[0.9375rem]">
                <input
                  type="checkbox"
                  checked={draft.condition.includes(c)}
                  onChange={() => toggleCondition(c)}
                />
                {tc(c)}
              </label>
            ))}
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="mb-2 text-base font-semibold">{t("priceRange")}</legend>
            <div className="flex items-center gap-2">
              <input
                className={fieldClass}
                inputMode="decimal"
                aria-label={t("minPrice")}
                placeholder={t("minPrice")}
                value={min}
                onChange={(e) => setMin(e.target.value)}
              />
              <span aria-hidden>–</span>
              <input
                className={fieldClass}
                inputMode="decimal"
                aria-label={t("maxPrice")}
                placeholder={t("maxPrice")}
                value={max}
                onChange={(e) => setMax(e.target.value)}
              />
            </div>
          </fieldset>

          <label className="block space-y-1 text-sm">
            <span className="font-semibold">{t("material")}</span>
            <input
              className={fieldClass}
              value={draft.material ?? ""}
              maxLength={60}
              onChange={(e) => setDraft((d) => ({ ...d, material: e.target.value }))}
            />
          </label>

          <label className="flex items-center gap-2 text-[0.9375rem]">
            <input
              type="checkbox"
              checked={draft.inStock}
              onChange={(e) => setDraft((d) => ({ ...d, inStock: e.target.checked }))}
            />
            {t("inStock")}
          </label>

          <Button type="submit" className="w-full">
            {t("apply")}
          </Button>
        </form>
      </aside>

      <div className="min-w-0 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            className="lg:hidden"
            aria-expanded={open}
            aria-controls="shop-filters"
            onClick={() => setOpen(true)}
          >
            <SlidersHorizontal aria-hidden />
            {t("filters")}
          </Button>
          <label className="ms-auto hidden shrink-0 items-center gap-2 whitespace-nowrap text-sm lg:flex">
            <span className="whitespace-nowrap text-muted-foreground">{t("sort.label")}</span>
            {sortSelect("sort-toolbar")}
          </label>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Remounts when the URL filters change so the draft form re-syncs (chips, back button). */
export function ShopFrame(props: Parameters<typeof ShopFrameInner>[0]) {
  return <ShopFrameInner key={shopHref(props.filters)} {...props} />;
}
