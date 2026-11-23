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
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { ArrowLeft, ArrowRight, GripVertical, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { presignUpload, putToR2, readImageSize, validateImageFile } from "@/lib/uploads";

// Reusable R2 image uploader (T-064; also used by the category form, T-067 banners next).
// The parent owns the list; every change goes through `onChange(updater)` because uploads
// finish asynchronously and must patch the latest list, never a stale copy.

export type UploaderImage = {
  id: string;
  /** R2 key; null while the file is still uploading or when it failed. */
  key: string | null;
  url: string | null;
  alt: { en: string; ar: string };
  width: number | null;
  height: number | null;
  status: "uploading" | "done" | "error";
  /** 0..1 while uploading. */
  progress: number;
  error?: string;
};

export type UploaderUpdate = (prev: UploaderImage[]) => UploaderImage[];

let seq = 0;
const localId = () => `img-${Date.now().toString(36)}-${seq++}`;

/** An image already stored on the server. */
export function storedImage(a: {
  key: string;
  url: string;
  alt?: { en: string; ar: string } | null;
  width?: number | null;
  height?: number | null;
}): UploaderImage {
  return {
    id: localId(),
    key: a.key,
    url: a.url,
    alt: { en: a.alt?.en ?? "", ar: a.alt?.ar ?? "" },
    width: a.width ?? null,
    height: a.height ?? null,
    status: "done",
    progress: 1,
  };
}

export const isUploading = (list: UploaderImage[]) => list.some((i) => i.status === "uploading");

/** Alt text is both locales or none (api-spec ImageAssetInput.alt: en and ar min 1 char). */
export function altState(i: UploaderImage): "none" | "ok" | "partial" {
  const en = i.alt.en.trim();
  const ar = i.alt.ar.trim();
  if (!en && !ar) return "none";
  return en && ar ? "ok" : "partial";
}

/** Request shape for ImageAssetInput: `{key, alt?}` only (B-030: width/height are not accepted). */
export function toImageInput(i: UploaderImage): { key: string; alt?: { en: string; ar: string } } {
  return altState(i) === "ok"
    ? { key: i.key as string, alt: { en: i.alt.en.trim(), ar: i.alt.ar.trim() } }
    : { key: i.key as string };
}

function Thumb({
  image,
  index,
  total,
  showAlt,
  onUpdate,
  onRemove,
  onMove,
  removeLabel,
}: {
  image: UploaderImage;
  index: number;
  total: number;
  showAlt: boolean;
  onUpdate: (patch: Partial<UploaderImage>) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  removeLabel?: string;
}) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const n = index + 1;
  return (
    <li
      ref={setNodeRef}
      data-testid="uploader-item"
      data-status={image.status}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={cn(
        "w-40 rounded-md border border-border bg-card p-2 text-xs text-card-foreground",
        isDragging && "z-10 opacity-80 shadow-md",
        image.status === "error" && "border-destructive",
      )}
    >
      <div className="relative aspect-square overflow-hidden rounded bg-muted">
        {image.url && image.status === "done" ? (
          <img src={image.url} alt={image.alt.en || image.alt.ar} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            {image.status === "uploading" ? (
              <progress
                value={Math.round(image.progress * 100)}
                max={100}
                aria-label={t("uploader.progress", { n })}
                className="w-3/4"
              />
            ) : (
              <ImagePlus className="size-6" aria-hidden />
            )}
          </div>
        )}
      </div>
      {image.status === "uploading" && (
        <p role="status" className="mt-1 text-muted-foreground">
          {t("uploader.uploading", { pct: Math.round(image.progress * 100) })}
        </p>
      )}
      {image.status === "error" && (
        <p role="alert" className="mt-1 text-destructive" data-testid="uploader-error">
          {image.error}
        </p>
      )}
      {showAlt && image.status === "done" && (
        <div className="mt-1 space-y-1">
          <Input
            dir="ltr"
            lang="en"
            className="h-8 text-xs"
            placeholder={t("uploader.altEn")}
            aria-label={t("uploader.altEnN", { n })}
            value={image.alt.en}
            onChange={(e) => onUpdate({ alt: { ...image.alt, en: e.target.value } })}
          />
          <Input
            dir="rtl"
            lang="ar"
            className="h-8 text-xs"
            placeholder={t("uploader.altAr")}
            aria-label={t("uploader.altArN", { n })}
            value={image.alt.ar}
            onChange={(e) => onUpdate({ alt: { ...image.alt, ar: e.target.value } })}
          />
          {altState(image) === "partial" && (
            <p role="alert" className="text-destructive" data-testid="uploader-alt-error">
              {t("uploader.altBoth")}
            </p>
          )}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={t("uploader.drag", { n })}
          className="cursor-grab rounded p-1 text-muted-foreground hover:bg-muted"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden />
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          aria-label={t("uploader.moveEarlier", { n })}
          disabled={index === 0}
          onClick={() => onMove(index - 1)}
        >
          <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          aria-label={t("uploader.moveLater", { n })}
          disabled={index === total - 1}
          onClick={() => onMove(index + 1)}
        >
          <ArrowRight className="size-4 rtl:rotate-180" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          aria-label={removeLabel ?? t("uploader.remove", { n })}
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>
    </li>
  );
}

export function ImageUploader({
  images,
  onChange,
  max,
  showAlt = false,
  testId = "image-uploader",
  removeLabel,
}: {
  images: UploaderImage[];
  onChange: (update: UploaderUpdate) => void;
  max: number;
  showAlt?: boolean;
  testId?: string;
  /** Overrides the per-image remove button label (single-image fields). */
  removeLabel?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const input = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const patch = (id: string, p: Partial<UploaderImage>) =>
    onChange((prev) => prev.map((i) => (i.id === id ? { ...i, ...p } : i)));

  async function start(file: File) {
    const id = localId();
    const add: UploaderImage = {
      id,
      key: null,
      url: null,
      alt: { en: "", ar: "" },
      width: null,
      height: null,
      status: "uploading",
      progress: 0,
    };
    onChange((prev) => [...prev, add]);
    try {
      const ps = await presignUpload(file);
      void readImageSize(file).then((s) => s && patch(id, { width: s.width, height: s.height }));
      await putToR2(ps.uploadUrl, file, (f) => patch(id, { progress: f }));
      patch(id, { key: ps.key, url: ps.publicUrl, status: "done", progress: 1 });
    } catch (e) {
      const failed = e instanceof Error && e.message === "UPLOAD_FAILED";
      patch(id, { status: "error", error: failed ? t("uploader.err.failed") : errorMessage(t, locale, e) });
    }
  }

  function pick(files: FileList | File[] | null) {
    if (!files) return;
    setNotice(null);
    let slots = max - images.length;
    for (const f of Array.from(files)) {
      const bad = validateImageFile(f);
      if (bad) {
        setNotice(t(`uploader.err.${bad}`, { name: f.name }));
        continue;
      }
      if (slots <= 0) {
        setNotice(t("uploader.err.max", { max }));
        break;
      }
      slots -= 1;
      void start(f);
    }
    if (input.current) input.current.value = "";
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const overId = e.over.id;
    onChange((prev) => {
      const from = prev.findIndex((i) => i.id === e.active.id);
      const to = prev.findIndex((i) => i.id === overId);
      return from < 0 || to < 0 ? prev : arrayMove(prev, from, to);
    });
  };

  return (
    <div data-testid={testId}>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border p-3"
      >
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={max > 1}
          className="sr-only"
          tabIndex={-1}
          data-testid={`${testId}-input`}
          aria-label={t("uploader.fileInput")}
          onChange={(e) => pick(e.target.files)}
        />
        <Button variant="outline" size="sm" disabled={images.length >= max} onClick={() => input.current?.click()}>
          <ImagePlus className="size-4" aria-hidden />
          {t("uploader.choose")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("uploader.hint", { max })}</p>
      </div>
      {notice && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="uploader-notice">
          {notice}
        </p>
      )}
      {images.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={images.map((i) => i.id)} strategy={rectSortingStrategy}>
            <ul className="mt-3 flex flex-wrap gap-3">
              {images.map((img, idx) => (
                <Thumb
                  key={img.id}
                  image={img}
                  index={idx}
                  total={images.length}
                  showAlt={showAlt}
                  removeLabel={removeLabel}
                  onUpdate={(p) => patch(img.id, p)}
                  onRemove={() => onChange((prev) => prev.filter((i) => i.id !== img.id))}
                  onMove={(to) => onChange((prev) => arrayMove(prev, idx, to))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
