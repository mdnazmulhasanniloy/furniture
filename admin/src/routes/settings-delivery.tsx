import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activeCount,
  cityErrors,
  MAX_CITIES,
  slugify,
  uniqueCode,
  type CityError,
  type CityRow,
} from "@/lib/delivery";
import { formatNumber, toLocale } from "@/lib/format";
import { moveItem } from "@/lib/sections";
import type { SettingsFormValues } from "@/lib/settings";
import { cn } from "@/lib/utils";

function AddCityDialog({ rows, onAdd, onClose }: { rows: CityRow[]; onAdd: (r: CityRow) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [nameEn, setNameEn] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [error, setError] = useState<{ en?: string; ar?: string; code?: string }>({});
  const submit = (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const err: typeof error = {};
    if (!nameEn.trim()) err.en = t("settings.form.required");
    if (!nameAr.trim()) err.ar = t("settings.form.required");
    const code = uniqueCode(
      slugify(nameEn),
      rows.map((r) => r.code),
    );
    if (nameEn.trim() && !code) err.code = t("settings.delivery.codeNeedsLatin");
    setError(err);
    if (err.en || err.ar || err.code) return;
    onAdd({
      code,
      nameEn: nameEn.trim(),
      nameAr: nameAr.trim(),
      isActive: true,
      fee: "",
      orig: { code, name: { en: nameEn.trim(), ar: nameAr.trim() }, isActive: true, sortOrder: rows.length, deliveryFee: null },
    });
    onClose();
  };
  return (
    <Modal title={t("settings.delivery.addCity")} onClose={onClose} testId="city-dialog">
      <form onSubmit={submit} noValidate>
        <Field label={t("settings.delivery.nameEn")} htmlFor="city-new-en" error={error.en ?? error.code}>
          <Input id="city-new-en" dir="ltr" lang="en" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </Field>
        <Field label={t("settings.delivery.nameAr")} htmlFor="city-new-ar" error={error.ar}>
          <Input id="city-new-ar" dir="rtl" lang="ar" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </Field>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.delivery.codeHint")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" data-testid="city-add-confirm">
            {t("settings.delivery.addCity")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CityItem({
  row,
  index,
  total,
  error,
  onChange,
  onMove,
  lastActive,
}: {
  row: CityRow;
  index: number;
  total: number;
  error: CityError | null;
  onChange: (patch: Partial<CityRow>) => void;
  onMove: (from: number, to: number) => void;
  lastActive: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.code,
  });
  const name = row.code;
  const errText = error ? t(`settings.delivery.cityError.${error}`) : null;
  return (
    <li
      ref={setNodeRef}
      data-testid="city-row"
      data-code={row.code}
      style={{
        transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        "flex flex-wrap items-start gap-3 border-t border-border bg-card px-3 py-3 first:border-t-0",
        isDragging && "relative z-10 shadow-md",
        !row.isActive && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("settings.delivery.dragHandle", { name })}
        className="inline-flex size-9 cursor-grab touch-none items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 pt-2 text-center text-xs text-muted-foreground">{formatNumber(index + 1, locale)}</span>
      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          aria-label={t("settings.delivery.cityNameEn", { name })}
          dir="ltr"
          lang="en"
          value={row.nameEn}
          onChange={(e) => onChange({ nameEn: e.target.value })}
          aria-invalid={error === "name" && !row.nameEn.trim()}
        />
        <Input
          aria-label={t("settings.delivery.cityNameAr", { name })}
          dir="rtl"
          lang="ar"
          value={row.nameAr}
          onChange={(e) => onChange({ nameAr: e.target.value })}
          aria-invalid={error === "name" && !row.nameAr.trim()}
        />
        <Input
          aria-label={t("settings.delivery.cityCode", { name })}
          dir="ltr"
          value={row.code}
          readOnly
          className="text-muted-foreground"
          data-testid="city-code"
        />
        <Input
          aria-label={t("settings.delivery.cityFee", { name })}
          dir="ltr"
          inputMode="decimal"
          placeholder={t("settings.delivery.baseFeePlaceholder")}
          value={row.fee}
          onChange={(e) => onChange({ fee: e.target.value })}
          aria-invalid={error === "negative" || error === "invalid"}
        />
        {errText && (
          <p role="alert" className="text-xs text-destructive sm:col-span-2 lg:col-span-4" data-testid="city-error">
            {errText}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={row.isActive}
        aria-label={t("settings.delivery.toggleActive", { name })}
        disabled={row.isActive && lastActive}
        onClick={() => onChange({ isActive: !row.isActive })}
        className={cn(
          "mt-2 inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors disabled:opacity-50",
          row.isActive ? "bg-primary" : "bg-muted",
        )}
      >
        <span className={cn("size-4 rounded-full bg-card transition-transform", row.isActive && "translate-x-5 rtl:-translate-x-5")} />
      </button>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("settings.delivery.moveUp", { name })}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("settings.delivery.moveDown", { name })}
          disabled={index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function DeliveryPanel({
  register,
  errs,
  rows,
  setRows,
  showErrors,
}: {
  register: UseFormRegister<SettingsFormValues>;
  errs: FieldErrors<SettingsFormValues>;
  rows: CityRow[];
  setRows: (fn: (r: CityRow[]) => CityRow[]) => void;
  showErrors: boolean;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const errors = cityErrors(rows);
  const onlyOneActive = activeCount(rows) === 1;
  const move = (a: number, b: number) => setRows((r) => moveItem(r, a, b));
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    move(
      rows.findIndex((r) => r.code === e.active.id),
      rows.findIndex((r) => r.code === over.id),
    );
  };
  const msg = (m?: string) => (m ? t(m) : undefined);
  return (
    <>
      <Field label={t("settings.delivery.baseFee")} htmlFor="set-fee" hint={t("settings.delivery.baseFeeHint")} error={msg(errs.deliveryFee?.message)}>
        <Input id="set-fee" dir="ltr" inputMode="decimal" aria-invalid={!!errs.deliveryFee} {...register("deliveryFee")} />
      </Field>
      <Field
        label={t("settings.delivery.threshold")}
        htmlFor="set-threshold"
        hint={t("settings.delivery.thresholdHint")}
        error={msg(errs.freeThreshold?.message)}
      >
        <Input id="set-threshold" dir="ltr" inputMode="decimal" aria-invalid={!!errs.freeThreshold} {...register("freeThreshold")} />
      </Field>

      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">{t("settings.delivery.cities")}</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= MAX_CITIES}
          onClick={() => setAdding(true)}
          data-testid="city-add"
        >
          <Plus className="size-4" aria-hidden /> {t("settings.delivery.addCity")}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("settings.delivery.citiesHint")}</p>
      {onlyOneActive && (
        <p className="mt-2 text-sm text-muted-foreground" data-testid="city-last-active">
          {t("settings.delivery.lastActive")}
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.code)} strategy={verticalListSortingStrategy}>
          <ul className="mt-3 overflow-hidden rounded-lg border border-border" data-testid="city-list">
            {rows.map((r, i) => (
              <CityItem
                key={r.code}
                row={r}
                index={i}
                total={rows.length}
                error={showErrors ? errors[i] : null}
                lastActive={onlyOneActive}
                onChange={(p) => setRows((all) => all.map((x) => (x.code === r.code ? { ...x, ...p } : x)))}
                onMove={move}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {adding &&
        createPortal(
          <AddCityDialog rows={rows} onAdd={(r) => setRows((all) => [...all, r])} onClose={() => setAdding(false)} />,
          document.body,
        )}
    </>
  );
}
