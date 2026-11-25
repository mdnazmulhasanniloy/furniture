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
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import { formatNumber, toLocale } from "@/lib/format";
import { dragLooks, hasDeadPoint, moveAmongLooks, useLooks, type AdminLook } from "@/lib/looks";
import { useDeleteSection, useReorderSections, useSaveSection } from "@/lib/sections";
import { cn } from "@/lib/utils";

// T-085 step 2. Looks are home sections, so every write here is a home-section route; the reorder endpoint
// wants the complete id list, which is why a move is computed against the whole list (see `moveAmongLooks`).

function DeleteDialog({ look, onClose }: { look: AdminLook; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeleteSection();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("sections.looks.delete.title")} onClose={onClose} testId="look-delete-dialog">
      <p className="mt-3 text-sm">{t("sections.looks.delete.body")}</p>
      <p className="mt-1 text-sm font-medium">{look.title[locale]}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="look-delete-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} data-testid="look-delete-cancel">
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={del.isPending}
          data-testid="look-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(look.id);
              onClose();
            } catch (e) {
              setError(errorMessage(t, locale, e));
            }
          }}
        >
          {t("common.delete")}
        </Button>
      </div>
    </Modal>
  );
}

function Row({
  look,
  index,
  total,
  busy,
  onMove,
  onToggle,
  onDelete,
}: {
  look: AdminLook;
  index: number;
  total: number;
  busy: boolean;
  onMove: (delta: 1 | -1) => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: look.id, disabled: busy });
  const name = look.title[locale];
  const { image, hotspots } = look.config.look;
  return (
    <li
      ref={setNodeRef}
      data-testid="look-row"
      data-id={look.id}
      style={{
        transform: transform
          ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)`
          : undefined,
        transition,
      }}
      className={cn(
        "flex flex-wrap items-center gap-3 border-t border-border bg-card p-3 first:border-t-0",
        isDragging && "relative z-10 shadow-md",
        !look.isVisible && "text-muted-foreground",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={t("sections.dragHandle", { name })}
        data-testid="look-handle"
        className="inline-flex size-9 cursor-grab touch-none items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <img
        src={image.url}
        alt={image.alt[locale]}
        width={image.width}
        height={image.height}
        className="h-14 w-20 shrink-0 rounded-sm border border-border object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium" data-testid="look-title">
          {name}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="look-points">
          {t("sections.looks.col.points")}: {formatNumber(hotspots.length, locale)}
        </p>
        {hasDeadPoint(look) && (
          <p
            className="mt-1 flex items-start gap-1 text-xs text-warning-foreground"
            data-testid="look-warning"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("sections.looks.unpublished")}
          </p>
        )}
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-xs",
          look.isVisible ? "bg-success/15 text-success-foreground" : "bg-muted text-muted-foreground",
        )}
        data-testid="look-visibility"
      >
        {look.isVisible ? t("sections.visible") : t("sections.hidden")}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={look.isVisible}
        aria-label={t("sections.toggleVisible", { name })}
        disabled={busy}
        onClick={onToggle}
        className={cn(
          "inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors",
          look.isVisible ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-card transition-transform",
            look.isVisible && "translate-x-5 rtl:-translate-x-5",
          )}
        />
      </button>
      <div className="flex gap-1">
        {/* Keyboard and assistive-technology alternative to dragging. */}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sections.moveUp", { name })}
          data-testid="look-move-up"
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="size-4" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sections.moveDown", { name })}
          data-testid="look-move-down"
          disabled={busy || index === total - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="size-4" aria-hidden />
        </Button>
        <Link
          to={`/sections/looks/${encodeURIComponent(look.id)}`}
          aria-label={t("sections.editNamed", { name })}
          data-testid="look-edit"
          className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Pencil className="size-4" aria-hidden />
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("sections.looks.delete.title")}
          data-testid="look-delete"
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function LooksPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { query, looks, allIds, lookIds } = useLooks();
  const reorder = useReorderSections();
  const toggle = useSaveSection();
  const [deleting, setDeleting] = useState<AdminLook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const busy = reorder.isPending || toggle.isPending;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const commit = async (ids: string[], movedId: string, to: number) => {
    setError(null);
    try {
      await reorder.mutateAsync(ids);
      const moved = looks.find((l) => l.id === movedId);
      if (moved) {
        setAnnounce(
          t("sections.moved", {
            name: moved.title[locale],
            position: formatNumber(to + 1, locale),
            total: formatNumber(looks.length, locale),
          }),
        );
      }
    } catch (e) {
      setError(errorMessage(t, locale, e));
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || e.active.id === over.id || busy) return;
    const from = lookIds.indexOf(String(e.active.id));
    const to = lookIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    void commit(dragLooks(allIds, lookIds, from, to), String(e.active.id), to);
  };

  return (
    <section aria-labelledby="looks-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="looks-title" className="font-display text-2xl font-semibold">
          {t("sections.looks.title")}
        </h1>
        <Link
          to="/sections/looks/new"
          data-testid="look-new"
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" aria-hidden />
          {t("sections.looks.new")}
        </Link>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("sections.hint")}</p>
      {query.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("sections.loading")}
        </p>
      )}
      {query.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="looks-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, query.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            {t("sections.retry")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="looks-row-error">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only" data-testid="looks-announce">
        {announce}
      </p>
      {query.isSuccess && looks.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="looks-empty">
          {t("sections.looks.empty")}
        </p>
      )}
      {query.isSuccess && looks.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={lookIds} strategy={verticalListSortingStrategy}>
            <ol className="mt-4 overflow-hidden rounded-lg border border-border" data-testid="looks-list">
              {looks.map((look, i) => (
                <Row
                  key={look.id}
                  look={look}
                  index={i}
                  total={looks.length}
                  busy={busy}
                  onMove={(delta) =>
                    void commit(moveAmongLooks(allIds, lookIds, look.id, delta), look.id, i + delta)
                  }
                  onDelete={() => setDeleting(look)}
                  onToggle={async () => {
                    setError(null);
                    try {
                      await toggle.mutateAsync({
                        id: look.id,
                        body: { isVisible: !look.isVisible, expectedUpdatedAt: look.updatedAt },
                      });
                    } catch (e) {
                      setError(errorMessage(t, locale, e));
                      void query.refetch();
                    }
                  }}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {deleting && <DeleteDialog look={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
