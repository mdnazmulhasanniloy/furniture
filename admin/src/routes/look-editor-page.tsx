import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { altState, ImageUploader, isUploading, storedImage, type UploaderImage } from "@/components/image-uploader";
import { LookCanvas, pct, type CanvasPoint } from "@/components/look-canvas";
import { LookPreview } from "@/components/look-preview";
import { Field } from "@/components/modal";
import { ProductPicker } from "@/components/product-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { formatPrice, toLocale } from "@/lib/format";
import { MAX_POINTS, useLooks, type AdminLook } from "@/lib/looks";
import type { AdminProduct } from "@/lib/products";
import {
  sectionSchema,
  useCreateSection,
  useSaveSection,
  type LookHotspotProduct,
  type LookWrite,
  type SectionFormValues,
} from "@/lib/sections";
import { cn } from "@/lib/utils";

// T-085 steps 3-5. One look: the room photo, up to six points placed on it, and the product each point links
// to. The photo's own pixel size is saved with it (backend T-110) so the website can render it uncropped and
// a point stays on the same spot of the photo at every screen width.

/** A photo this tall or wide will look odd on one of the two screens; the admin is warned, not blocked. */
const RATIO_MIN = 0.5;
const RATIO_MAX = 2;

type Point = CanvasPoint & { productId: string | null; product: LookHotspotProduct | null };

let seq = 0;
const newId = () => `pt-${seq++}`;

const EN_FIELDS = ["titleEn", "subtitleEn"] as const;
const AR_FIELDS = ["titleAr", "subtitleAr"] as const;
const card = "rounded-lg border border-border bg-card p-4";

function Editor({
  look,
  nextOrder,
  onReload,
}: {
  look: AdminLook | null;
  nextOrder: number;
  onReload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const create = useCreateSection();
  const update = useSaveSection();
  const stored = look?.config.look;
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [photo, setPhoto] = useState<UploaderImage[]>(() => (stored ? [storedImage(stored.image)] : []));
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    stored ? { width: stored.image.width, height: stored.image.height } : null,
  );
  const [points, setPoints] = useState<Point[]>(() =>
    (stored?.hotspots ?? []).map((h) => ({
      id: newId(),
      x: h.x,
      y: h.y,
      productId: h.productId,
      product: h.product ?? null,
    })),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const { register, handleSubmit, formState, watch } = useForm<SectionFormValues>({
    resolver: zodResolver(sectionSchema),
    defaultValues: {
      titleEn: look?.title.en ?? "",
      titleAr: look?.title.ar ?? "",
      subtitleEn: look?.subtitle?.en ?? "",
      subtitleAr: look?.subtitle?.ar ?? "",
      limit: "8",
      isVisible: look?.isVisible ?? true,
      hasLimit: false, // looks have no product count; the field is not shown
    },
  });
  const errs = formState.errors;
  const values = watch(); // the preview follows what is being typed
  const msg = (m?: string) => (m ? t(m) : undefined);
  const image = photo.find((i) => i.status === "done" && i.key);
  const saving = create.isPending || update.isPending;
  const ratio = size ? size.width / size.height : null;
  const oddRatio = ratio !== null && (ratio < RATIO_MIN || ratio > RATIO_MAX);

  const patch = (id: string, p: Partial<Point>) =>
    setPoints((prev) => prev.map((pt) => (pt.id === id ? { ...pt, ...p } : pt)));

  const addPoint = (x: number, y: number) => {
    setFormError(null);
    if (points.length >= MAX_POINTS) {
      setFormError(t("sections.looks.editor.pointsMax"));
      return;
    }
    const id = newId();
    setPoints((prev) => [...prev, { id, x, y, productId: null, product: null }]);
    setSelected(id);
    setPicking(id); // placing a point and choosing its product is one motion
  };

  const onValid = async (v: SectionFormValues) => {
    setFormError(null);
    if (isUploading(photo)) return setFormError(t("products.editor.uploadingWait"));
    if (!image) return setFormError(t("sections.looks.editor.photoRequired"));
    if (altState(image) !== "ok") return setFormError(t("sections.looks.editor.altRequired"));
    // The photo's own size: measured by the uploader, read off the loaded photo, or kept from the stored
    // look. Until one of those has answered, the photo is simply not ready yet.
    const measured = size ?? (image.width && image.height ? { width: image.width, height: image.height } : null);
    if (!measured) return setFormError(t("products.editor.uploadingWait"));
    if (points.length === 0) return setFormError(t("sections.looks.editor.pointsRequired"));
    if (points.some((p) => !p.productId)) return setFormError(t("sections.looks.editor.productRequired"));

    const lookWrite: LookWrite = {
      image: {
        key: image.key as string,
        alt: { en: image.alt.en.trim(), ar: image.alt.ar.trim() },
        width: measured.width,
        height: measured.height,
      },
      hotspots: points.map((p) => ({ x: p.x, y: p.y, productId: p.productId as string })),
    };
    const both = (en: string, ar: string) => (en && ar ? { en, ar } : null);
    try {
      if (look) {
        await update.mutateAsync({
          id: look.id,
          body: {
            title: { en: v.titleEn, ar: v.titleAr },
            subtitle: both(v.subtitleEn, v.subtitleAr),
            isVisible: v.isVisible,
            config: { look: lookWrite },
            expectedUpdatedAt: look.updatedAt, // optimistic concurrency (api-spec HomeSectionPatch)
          },
        });
      } else {
        await create.mutateAsync({
          type: "SHOP_THE_LOOK",
          title: { en: v.titleEn, ar: v.titleAr },
          subtitle: both(v.subtitleEn, v.subtitleAr),
          isVisible: v.isVisible,
          config: { look: lookWrite },
          sortOrder: nextOrder, // a new look goes last; the order is changed on the list
        });
      }
      navigate("/sections/looks");
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
        id={`look-tab-${l}`}
        aria-selected={tab === l}
        aria-controls={`look-panel-${l}`}
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
    const X = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    return (
      <div role="tabpanel" id={`look-panel-${l}`} aria-labelledby={`look-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`sections.form.title${X}`)} htmlFor={`look-title-${l}`} error={msg(errs[`title${X}`]?.message)}>
          <Input id={`look-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`title${X}`]} {...register(`title${X}`)} />
        </Field>
        <Field label={t(`sections.form.subtitle${X}`)} htmlFor={`look-sub-${l}`} error={msg(errs[`subtitle${X}`]?.message)}>
          <Input id={`look-sub-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`subtitle${X}`]} {...register(`subtitle${X}`)} />
        </Field>
      </div>
    );
  };

  const Back = locale === "ar" ? ArrowRight : ArrowLeft;
  const usedIds = points.flatMap((p) => (p.productId && p.id !== picking ? [p.productId] : []));

  return (
    <section aria-labelledby="look-editor-title" data-testid="look-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/sections/looks"
            data-testid="look-back"
            aria-label={t("sections.looks.back")}
            className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted"
          >
            <Back className="size-5" aria-hidden />
          </Link>
          <h1 id="look-editor-title" className="font-display text-2xl font-semibold">
            {t(look ? "sections.looks.editor.titleEdit" : "sections.looks.editor.titleNew")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/sections/looks")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="look-form" disabled={saving} data-testid="look-save">
            {t("common.save")}
          </Button>
        </div>
      </div>
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="look-stale"
        >
          <p>{t("sections.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("sections.form.reload")}
          </Button>
        </div>
      )}
      <form
        id="look-form"
        onSubmit={handleSubmit(onValid, onInvalid)}
        noValidate
        className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]"
      >
        <div className="space-y-4">
          <fieldset className={card}>
            <legend className="px-1 text-base font-semibold">{t("sections.form.languages")}</legend>
            <div role="tablist" aria-label={t("sections.form.languages")} className="flex border-b border-border">
              {tabBtn("ar", AR_FIELDS)}
              {tabBtn("en", EN_FIELDS)}
            </div>
            {panel("ar")}
            {panel("en")}
            <div className="mt-3 flex items-center gap-2">
              <input id="look-visible" type="checkbox" className="size-4 accent-primary" {...register("isVisible")} />
              <label htmlFor="look-visible" className="text-sm">
                {t("sections.form.visible")}
              </label>
            </div>
          </fieldset>

          <fieldset className={card}>
            <legend className="px-1 text-base font-semibold">{t("sections.looks.editor.photo")}</legend>
            <ImageUploader images={photo} onChange={setPhoto} max={1} showAlt testId="look-photo" />
            <p className="mt-1 text-xs text-muted-foreground">{t("sections.looks.editor.photoHint")}</p>
            {oddRatio && (
              <p className="mt-2 flex items-start gap-1 text-xs text-warning-foreground" data-testid="look-ratio-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("sections.looks.editor.ratioWarning")}
              </p>
            )}
          </fieldset>

          <fieldset className={card}>
            <legend className="px-1 text-base font-semibold">{t("sections.looks.editor.points")}</legend>
            <p className="text-xs text-muted-foreground">{t("sections.looks.editor.addHint")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("sections.looks.editor.keyboardHint")}</p>
            {image?.url && (
              <div className="mt-3">
                <LookCanvas
                  src={image.url}
                  alt={image.alt[locale] || ""}
                  points={points}
                  selected={selected}
                  onSelect={setSelected}
                  onAdd={addPoint}
                  onMove={(id, x, y) => patch(id, { x, y })}
                  onRemove={(id) => setPoints((prev) => prev.filter((p) => p.id !== id))}
                  onPhotoSize={setSize}
                />
              </div>
            )}
            <ol className="mt-3 space-y-2">
              {points.map((p, i) => (
                <li
                  key={p.id}
                  data-testid="look-point-row"
                  data-id={p.id}
                  className={cn(
                    "flex flex-wrap items-center gap-3 rounded-md border border-border p-2",
                    selected === p.id && "border-primary",
                  )}
                >
                  <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                    {i + 1}
                  </span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {pct(p.x)} · {pct(p.y)}
                  </span>
                  <span className="min-w-0 flex-1" data-testid="look-point-product">
                    {p.product ? (
                      <>
                        <span className="block truncate text-sm font-medium">{p.product.title[locale]}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatPrice(p.product.price, locale)}
                        </span>
                        {p.product.status !== "PUBLISHED" && (
                          <span className="mt-1 block text-xs text-warning-foreground" data-testid="look-point-warning">
                            {t("sections.looks.editor.productUnpublished")}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-sm text-muted-foreground">{t("sections.looks.editor.productRequired")}</span>
                    )}
                  </span>
                  <Button type="button" variant="outline" size="sm" data-testid="look-choose" onClick={() => setPicking(p.id)}>
                    {t(p.product ? "sections.looks.editor.change" : "sections.looks.editor.choose")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-testid="look-point-remove"
                    aria-label={t("sections.looks.editor.removePoint", { n: i + 1 })}
                    onClick={() => setPoints((prev) => prev.filter((x) => x.id !== p.id))}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ol>
          </fieldset>
          {formError && (
            <p role="alert" className="text-sm text-destructive" data-testid="look-form-error">
              {formError}
            </p>
          )}
        </div>

        <LookPreview
          device={device}
          onDevice={setDevice}
          src={image?.url ?? null}
          alt={image?.alt[locale] ?? ""}
          width={size?.width ?? null}
          height={size?.height ?? null}
          points={points}
          title={values[`title${locale === "en" ? "En" : "Ar"}`] || ""}
          subtitle={values[`subtitle${locale === "en" ? "En" : "Ar"}`] || ""}
        />
      </form>
      {picking && (
        <ProductPicker
          usedIds={usedIds}
          onClose={() => setPicking(null)}
          onPick={(p: AdminProduct) => {
            patch(picking, {
              productId: p.id,
              product: {
                id: p.id,
                title: p.title,
                slug: p.slug,
                price: p.price,
                status: p.status,
                image: p.images[0] ?? null,
              },
            });
            setPicking(null);
            setFormError(null);
          }}
        />
      )}
    </section>
  );
}

/** /sections/looks/new and /sections/looks/:id. The look comes from the sections list (no GET by id). */
export function LookEditorPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { query, all, looks } = useLooks();
  const [epoch, setEpoch] = useState(0);
  if (query.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("sections.loading")}
      </p>
    );
  }
  if (query.isError) {
    return (
      <div className="flex items-center gap-3" data-testid="looks-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, query.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t("sections.retry")}
        </Button>
      </div>
    );
  }
  const look = id ? looks.find((l) => l.id === id) : undefined;
  if (id && !look) return <Navigate to="/sections/looks" replace />;
  const nextOrder = all.reduce((m, s) => Math.max(m, s.sortOrder), 0) + 1;
  return (
    <Editor
      key={`${look?.id ?? "new"}-${epoch}`}
      look={look ?? null}
      nextOrder={nextOrder}
      onReload={async () => {
        await query.refetch();
        setEpoch((e) => e + 1);
      }}
    />
  );
}
