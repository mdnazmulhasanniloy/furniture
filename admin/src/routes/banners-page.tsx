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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/messages";
import {
  bannerState,
  useBanners,
  useDeleteBanner,
  useReorderBanners,
  useSaveBanner,
  type AdminBanner,
} from "@/lib/banners";
import { formatDateTime, toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

function DeleteDialog({ banner, onClose }: { banner: AdminBanner; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeleteBanner();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("banners.delete.title")} onClose={onClose} testId="banner-delete-dialog">
      <p className="mt-3 text-sm">{t("banners.delete.body")}</p>
      <p className="mt-1 text-sm font-medium">{banner.title[locale]}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="banner-delete-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={del.isPending}
          data-testid="banner-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(banner.id);
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

const STATE_CLASS = {
  active: "bg-success/15 text-success-foreground",
  scheduled: "bg-primary/15 text-primary",
  expired: "bg-muted text-muted-foreground",
  inactive: "bg-muted text-muted-foreground",
} as const;

function Row({
  b,
  index,
  count,
  busy,
  onMove,
  onDelete,
  onToggle,
}: {
  b: AdminBanner;
  index: number;
  count: number;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onDelete: (b: AdminBanner) => void;
  onToggle: (b: AdminBanner) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: b.id });
  const name = b.title[locale];
  const st = bannerState(b);
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}
      className={cn("border-t border-border bg-card", isDragging && "relative z-10 shadow-float")}
      data-testid="banner-row"
    >
      <td className="w-10 px-2 py-2 text-start">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`${t("banners.reorder.hint")} ${name}`}
          data-testid="banner-handle"
          className="inline-flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
      </td>
      <td className="px-3 py-2 text-start">
        <img src={b.imageDesktop.url} alt={b.imageDesktop.alt?.[locale] ?? ""} className="h-10 w-20 rounded object-cover" />
        {b.imageMobile && (
          <span className="mt-1 block text-xs text-muted-foreground" data-testid="banner-has-mobile">
            {t("banners.hasMobile")}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-start font-medium">
        {name}
        <span className="block text-xs font-normal text-muted-foreground">{b.title[locale === "ar" ? "en" : "ar"]}</span>
      </td>
      <td className="px-3 py-2 text-start text-xs">
        {b.startsAt || b.endsAt ? (
          <>
            <span className="block">
              {t("banners.from")}: {b.startsAt ? formatDateTime(b.startsAt, locale) : "—"}
            </span>
            <span className="block">
              {t("banners.to")}: {b.endsAt ? formatDateTime(b.endsAt, locale) : "—"}
            </span>
          </>
        ) : (
          t("banners.always")
        )}
      </td>
      <td className="px-3 py-2 text-start">
        <span className={cn("rounded-full px-2 py-0.5 text-xs", STATE_CLASS[st])} data-testid="banner-state">
          {t(`banners.state.${st}`)}
        </span>
      </td>
      <td className="px-3 py-2 text-start">
        <button
          type="button"
          role="switch"
          aria-checked={b.isActive}
          aria-label={t("banners.toggleActive", { name })}
          disabled={busy}
          onClick={() => onToggle(b)}
          className={cn("inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors", b.isActive ? "bg-primary" : "bg-muted")}
        >
          <span className={cn("size-4 rounded-full bg-card transition-transform", b.isActive && "translate-x-5 rtl:-translate-x-5")} />
        </button>
      </td>
      <td className="px-3 py-2 text-start">
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`${t("banners.moveUp")}: ${name}`} disabled={busy || index === 0} onClick={() => onMove(index, index - 1)} data-testid="banner-up">
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`${t("banners.moveDown")}: ${name}`} disabled={busy || index === count - 1} onClick={() => onMove(index, index + 1)} data-testid="banner-down">
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("banners.editNamed", { name })} onClick={() => navigate(`/banners/${encodeURIComponent(b.id)}`)}>
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("banners.deleteNamed", { name })} onClick={() => onDelete(b)}>
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </td>
    </tr>
  );
}

export function BannersPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const q = useBanners();
  const toggle = useSaveBanner();
  const reorder = useReorderBanners();
  const [deleting, setDeleting] = useState<AdminBanner | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // While a reorder is saving the list shows the new order at once; it falls back to the server's on failure.
  const [pending, setPending] = useState<string[] | null>(null);
  const server = [...(q.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const all = pending ? pending.map((id) => server.find((b) => b.id === id)).filter((b): b is AdminBanner => !!b) : server;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const move = async (from: number, to: number) => {
    if (to < 0 || to >= all.length || from === to) return;
    const ids = arrayMove(all, from, to).map((b) => b.id);
    setRowError(null);
    setPending(ids);
    try {
      await reorder.mutateAsync(ids);
    } catch (e) {
      setRowError(errorMessage(t, locale, e));
    } finally {
      setPending(null);
    }
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    void move(
      all.findIndex((b) => b.id === e.active.id),
      all.findIndex((b) => b.id === e.over!.id),
    );
  };

  return (
    <section aria-labelledby="ban-title">
      <div className="flex items-center justify-between gap-3">
        <h1 id="ban-title" className="font-display text-2xl font-semibold">
          {t("banners.title")}
        </h1>
        <Button onClick={() => navigate("/banners/new")} disabled={!q.isSuccess} data-testid="banner-new">
          <Plus className="size-4" aria-hidden />
          {t("banners.new")}
        </Button>
      </div>
      {q.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("banners.loading")}
        </p>
      )}
      {q.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="banners-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, q.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("banners.retry")}
          </Button>
        </div>
      )}
      {rowError && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="banners-row-error">
          {rowError}
        </p>
      )}
      {q.isSuccess && all.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed border-border p-8 text-center" data-testid="banners-empty">
          <p className="text-muted-foreground">{t("banners.empty")}</p>
          <Button className="mt-4" onClick={() => navigate("/banners/new")}>
            <Plus className="size-4" aria-hidden />
            {t("banners.new")}
          </Button>
        </div>
      )}
      {q.isSuccess && all.length > 0 && (
        <>
          <p className="mt-3 text-sm text-muted-foreground" data-testid="banners-hint">
            {t("banners.reorder.hint")}
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <table className="w-full text-sm" data-testid="banners-table">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-10 px-2 py-2">
                      <span className="sr-only">{t("banners.reorder.hint")}</span>
                    </th>
                    {(["image", "title", "schedule", "status", "active", "actions"] as const).map((k) => (
                      <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                        {t(`banners.col.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <SortableContext items={all.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                  <tbody>
                    {all.map((b, i) => (
                      <Row
                        key={b.id}
                        b={b}
                        index={i}
                        count={all.length}
                        busy={reorder.isPending || toggle.isPending}
                        onMove={(from, to) => void move(from, to)}
                        onDelete={setDeleting}
                        onToggle={async (banner) => {
                          setRowError(null);
                          try {
                            await toggle.mutateAsync({ id: banner.id, body: { isActive: !banner.isActive, expectedUpdatedAt: banner.updatedAt } });
                          } catch (e) {
                            setRowError(errorMessage(t, locale, e));
                            void q.refetch();
                          }
                        }}
                      />
                    ))}
                  </tbody>
                </SortableContext>
              </table>
            </DndContext>
          </div>
        </>
      )}
      {deleting && <DeleteDialog banner={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
