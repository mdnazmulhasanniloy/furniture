import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, GripVertical, Images, Pencil } from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { formatNumber, toLocale } from "@/lib/format";
import {
  bySortOrder,
  DEFAULT_LIMIT,
  LIMIT_TYPES,
  moveItem,
  sectionSchema,
  useReorderSections,
  useSaveSection,
  useSections,
  type AdminSection,
  type SectionFormValues,
  type SectionPatch,
} from "@/lib/sections";
import { cn } from "@/lib/utils";

const EN_FIELDS = ["titleEn", "subtitleEn"] as const;
const AR_FIELDS = ["titleAr", "subtitleAr"] as const;

function SectionForm({
  section,
  onClose,
  onReload,
}: {
  section: AdminSection;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSaveSection();
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hasLimit = LIMIT_TYPES.includes(section.type);
  const currentLimit = section.config?.limit ?? DEFAULT_LIMIT;
  const { register, handleSubmit, formState } = useForm<SectionFormValues>({
    resolver: zodResolver(sectionSchema),
    defaultValues: {
      titleEn: section.title.en,
      titleAr: section.title.ar,
      subtitleEn: section.subtitle?.en ?? "",
      subtitleAr: section.subtitle?.ar ?? "",
      limit: String(currentLimit),
      isVisible: section.isVisible,
      hasLimit,
    },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);

  const onValid = async (v: SectionFormValues) => {
    setFormError(null);
    const body: SectionPatch = {
      title: { en: v.titleEn, ar: v.titleAr },
      subtitle: v.subtitleEn && v.subtitleAr ? { en: v.subtitleEn, ar: v.subtitleAr } : null,
      isVisible: v.isVisible,
      expectedUpdatedAt: section.updatedAt, // optimistic concurrency (api-spec HomeSectionPatch)
    };
    // Only touch config when the limit changed; send the existing config merged so nothing else is lost,
    // whether the API replaces or merges.
    if (hasLimit && Number(v.limit) !== currentLimit)
      body.config = { ...(section.config ?? {}), limit: Number(v.limit) };
    try {
      await save.mutateAsync({ id: section.id, body });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<SectionFormValues>) => {
    if (EN_FIELDS.some((f) => e[f]) && !AR_FIELDS.some((f) => e[f])) setTab("en");
    else if (AR_FIELDS.some((f) => e[f])) setTab("ar");
  };
  const tabBtn = (l: "en" | "ar", fields: readonly (keyof SectionFormValues)[]) => {
    const hasErr = fields.some((f) => errs[f]);
    return (
      <button
        type="button"
        role="tab"
        id={`sec-tab-${l}`}
        aria-selected={tab === l}
        aria-controls={`sec-panel-${l}`}
        onClick={() => setTab(l)}
        className={cn(
          "h-9 border-b-2 px-3 text-sm",
          tab === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
          hasErr && "text-destructive",
        )}
      >
        {l === "en" ? t("common.english") : t("common.arabic")}
        {hasErr && <span className="sr-only"> ({t("sections.form.hasErrors")})</span>}
      </button>
    );
  };
  const panel = (l: "en" | "ar") => {
    const L = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    return (
      <div role="tabpanel" id={`sec-panel-${l}`} aria-labelledby={`sec-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`sections.form.title${L}`)} htmlFor={`sec-title-${l}`} error={msg(errs[`title${L}`]?.message)}>
          <Input id={`sec-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`title${L}`]} {...register(`title${L}`)} />
        </Field>
        <Field label={t(`sections.form.subtitle${L}`)} htmlFor={`sec-sub-${l}`} error={msg(errs[`subtitle${L}`]?.message)}>
          <Input id={`sec-sub-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`subtitle${L}`]} {...register(`subtitle${L}`)} />
        </Field>
      </div>
    );
  };

  return (
    <Modal title={t("sections.edit")} onClose={onClose} testId="section-dialog">
      <p className="mt-1 text-xs text-muted-foreground">{t(`sections.type.${section.type}`)}</p>
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="section-stale"
        >
          <p>{t("sections.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("sections.form.reload")}
          </Button>
        </div>
      )}
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
        <div role="tablist" aria-label={t("sections.form.languages")} className="mt-3 flex border-b border-border">
          {tabBtn("ar", AR_FIELDS)}
          {tabBtn("en", EN_FIELDS)}
        </div>
        {panel("ar")}
        {panel("en")}
        {hasLimit && (
          <Field
            label={t("sections.form.limit")}
            htmlFor="sec-limit"
            error={msg(errs.limit?.message)}
            hint={t("sections.form.limitHint")}
          >
            <Input id="sec-limit" inputMode="numeric" dir="ltr" aria-invalid={!!errs.limit} {...register("limit")} />
          </Field>
        )}
        <div className="mt-3 flex items-center gap-2">
          <input id="sec-visible" type="checkbox" className="size-4 accent-primary" {...register("isVisible")} />
          <label htmlFor="sec-visible" className="text-sm">
            {t("sections.form.visible")}
          </label>
        </div>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="section-form-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} data-testid="section-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Row({
  s,
  index,
  total,
  busy,
  onMove,
  onEdit,
  onToggle,
}: {
  s: AdminSection;
  index: number;
  total: number;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: s.id,
    disabled: busy,
  });
  const name = s.title[locale];
  return (
    <li
      ref={setNodeRef}
      data-testid="section-row"
      data-id={s.id}
      style={{
        transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-2 first:border-t-0",
        isDragging && "relative z-10 shadow-md",
        !s.isVisible && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("sections.dragHandle", { name })}
        data-testid="section-handle"
        className="inline-flex size-9 cursor-grab touch-none items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 text-center text-xs text-muted-foreground" data-testid="section-position">
        {formatNumber(index + 1, locale)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          {s.title[locale === "ar" ? "en" : "ar"]} · {t(`sections.type.${s.type}`)}
        </p>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs",
          s.isVisible ? "bg-success/15 text-success-foreground" : "bg-muted text-muted-foreground",
        )}
        data-testid="section-visibility"
      >
        {s.isVisible ? t("sections.visible") : t("sections.hidden")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={s.isVisible}
        aria-label={t("sections.toggleVisible", { name })}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          "inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors",
          s.isVisible ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn("size-4 rounded-full bg-card transition-transform", s.isVisible && "translate-x-5 rtl:-translate-x-5")}
        />
      </button>
      <div className="flex gap-1">
        {/* Keyboard / assistive-technology alternative to dragging. */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sections.moveUp", { name })}
          disabled={busy || index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sections.moveDown", { name })}
          disabled={busy || index === total - 1}
          onClick={() => onMove(index, index + 1)}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("sections.editNamed", { name })} onClick={onEdit}>
          <Pencil className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function SectionsPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useSections();
  const reorder = useReorderSections();
  const toggle = useSaveSection();
  const [editing, setEditing] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const all = [...(q.data ?? [])].sort(bySortOrder);
  const current = editing ? all.find((s) => s.id === editing) : undefined;
  const busy = reorder.isPending || toggle.isPending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commit = async (from: number, to: number) => {
    if (from === to || busy) return;
    const next = moveItem(all, from, to);
    setError(null);
    try {
      await reorder.mutateAsync(next.map((s) => s.id));
      setAnnounce(
        t("sections.moved", {
          name: all[from].title[locale],
          position: formatNumber(to + 1, locale),
          total: formatNumber(all.length, locale),
        }),
      );
    } catch (e) {
      setError(errorMessage(t, locale, e));
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id) return;
    void commit(
      all.findIndex((s) => s.id === e.active.id),
      all.findIndex((s) => s.id === over.id),
    );
  };

  return (
    <section aria-labelledby="sec-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="sec-title" className="font-display text-2xl font-semibold">
          {t("sections.title")}
        </h1>
        {/* "Shop the look" needs a photo and points, which this form cannot edit: it has its own page (T-085). */}
        <Link
          to="/sections/looks"
          data-testid="sections-manage-looks"
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Images className="size-4" aria-hidden />
          {t("sections.looks.manage")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("sections.hint")}</p>
      {q.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("sections.loading")}
        </p>
      )}
      {q.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="sections-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, q.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("sections.retry")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="sections-row-error">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only" data-testid="sections-announce">
        {announce}
      </p>
      {q.isSuccess && all.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="sections-empty">
          {t("sections.empty")}
        </p>
      )}
      {q.isSuccess && all.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={all.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <ol className="mt-4 overflow-hidden rounded-lg border border-border" data-testid="sections-list">
              {all.map((s, i) => (
                <Row
                  key={s.id}
                  s={s}
                  index={i}
                  total={all.length}
                  busy={busy}
                  onMove={(a, b) => void commit(a, b)}
                  onEdit={() => setEditing(s.id)}
                  onToggle={async () => {
                    setError(null);
                    try {
                      await toggle.mutateAsync({
                        id: s.id,
                        body: { isVisible: !s.isVisible, expectedUpdatedAt: s.updatedAt },
                      });
                    } catch (e) {
                      setError(errorMessage(t, locale, e));
                      void q.refetch();
                    }
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {current && (
        <SectionForm
          key={`${current.id}-${epoch}`}
          section={current}
          onClose={() => setEditing(null)}
          onReload={async () => {
            await q.refetch();
            setEpoch((e) => e + 1);
          }}
        />
      )}
    </section>
  );
}
