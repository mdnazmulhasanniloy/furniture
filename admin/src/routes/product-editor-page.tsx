import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, type FieldErrors, type FieldPath } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { Field, Modal } from "@/components/modal";
import { altState, ImageUploader, isUploading, storedImage, toImageInput, type UploaderImage } from "@/components/image-uploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { slugify, sortAsTree, useCategories } from "@/lib/categories";
import { formatPrice, toLocale } from "@/lib/format";
import { parseSar } from "@/lib/money";
import {
  MAX_IMAGES,
  productSchema,
  RESALE_CONDITIONS,
  toFormValues,
  toWrite,
  useProduct,
  useSaveProduct,
  type AdminProduct,
  type Condition,
  type ProductFormValues,
} from "@/lib/products";
import { useUnsavedGuard } from "@/lib/unsaved-guard";
import { cn } from "@/lib/utils";

const selectCls =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const areaCls =
  "min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-card-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring aria-[invalid=true]:border-destructive";

const imageSig = (l: UploaderImage[]) =>
  JSON.stringify(l.map((i) => [i.key, i.alt.en.trim(), i.alt.ar.trim()]));
const EN_FIELDS: FieldPath<ProductFormValues>[] = ["titleEn", "descEn", "notesEn"];
const AR_FIELDS: FieldPath<ProductFormValues>[] = ["titleAr", "descAr", "notesAr"];

function ProductEditor({ product, onReload }: { product: AdminProduct | null; onReload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const save = useSaveProduct();
  const cats = useCategories();
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [images, setImages] = useState<UploaderImage[]>(() => (product?.images ?? []).map(storedImage));
  const [initialSig] = useState(() => imageSig(images));
  const [slugTouched, setSlugTouched] = useState(!!product);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [done, setDone] = useState(false);
  const form = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
    defaultValues: toFormValues(product),
  });
  const { register, handleSubmit, formState, watch, setValue } = form;
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const dirty = !done && (formState.isDirty || imageSig(images) !== initialSig);
  const guard = useUnsavedGuard(dirty);

  // QA A2 (2026-11-24): the category <select> is registered while /admin/categories is still in flight,
  // so react-hook-form applies the product's id to a select that has no matching <option> yet and the
  // element falls back to the placeholder - the category looked unset, and because a select is read back
  // from the DOM on blur, opening and leaving the field really did clear it ("This field is required" on
  // save). Re-applying the loaded values once, as soon as the options exist, fixes both; `keepDirtyValues`
  // keeps anything already typed.
  const catsReady = cats.data !== undefined;
  const applied = useRef(false);
  useEffect(() => {
    if (!catsReady || applied.current) return;
    applied.current = true;
    form.reset(toFormValues(product), { keepDirtyValues: true });
  }, [catsReady, form, product]);

  const type = watch("type");
  const titleEn = watch("titleEn");
  const status = watch("status");
  const price = watch("price");
  const compare = watch("compareAtPrice");
  useEffect(() => {
    if (!slugTouched) setValue("slug", slugify(titleEn));
  }, [titleEn, slugTouched, setValue]);
  // The typed SAR amount read back as the customer sees it (A3): invalid text has no preview.
  const preview = (v: string) => {
    const p = parseSar(v);
    return p.ok ? formatPrice(p.halalas, locale) : "—";
  };
  const conditions: Condition[] = type === "NEW" ? ["NEW"] : RESALE_CONDITIONS;

  const onValid = async (v: ProductFormValues) => {
    setFormError(null);
    if (isUploading(images)) {
      setFormError(t("products.editor.uploadingWait"));
      return;
    }
    const ready = images.filter((i) => i.status === "done" && i.key);
    if (ready.some((i) => altState(i) === "partial")) {
      setFormError(t("products.form.altIncomplete"));
      return;
    }
    const body = toWrite(v, ready.map(toImageInput));
    try {
      await save.mutateAsync({
        id: product?.id,
        // Optimistic concurrency: the updatedAt we loaded (api-spec ProductPatch).
        body: product ? { ...body, expectedUpdatedAt: product.updatedAt } : body,
      });
      setDone(true);
      void navigate("/products");
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<ProductFormValues>) => {
    if (EN_FIELDS.some((f) => e[f]) && !AR_FIELDS.some((f) => e[f])) setTab("en");
    else if (AR_FIELDS.some((f) => e[f])) setTab("ar");
  };

  const tabBtn = (l: "en" | "ar", fields: FieldPath<ProductFormValues>[]) => {
    const hasErr = fields.some((f) => errs[f]);
    return (
      <button
        type="button"
        role="tab"
        id={`prod-tab-${l}`}
        aria-selected={tab === l}
        aria-controls={`prod-panel-${l}`}
        onClick={() => setTab(l)}
        className={cn(
          "h-9 border-b-2 px-3 text-sm",
          tab === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
          hasErr && "text-destructive",
        )}
      >
        {l === "en" ? t("common.english") : t("common.arabic")}
        {hasErr && <span className="sr-only"> ({t("products.form.hasErrors")})</span>}
      </button>
    );
  };
  const panel = (l: "en" | "ar") => {
    const L = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    return (
      <div role="tabpanel" id={`prod-panel-${l}`} aria-labelledby={`prod-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`products.form.title${L}`)} htmlFor={`prod-title-${l}`} error={msg(errs[`title${L}`]?.message)}>
          <Input id={`prod-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`title${L}`]} {...register(`title${L}`)} />
        </Field>
        <Field label={t(`products.form.desc${L}`)} htmlFor={`prod-desc-${l}`} error={msg(errs[`desc${L}`]?.message)}>
          <textarea id={`prod-desc-${l}`} dir={dir} lang={l} rows={5} className={areaCls} aria-invalid={!!errs[`desc${L}`]} {...register(`desc${L}`)} />
        </Field>
        <Field label={t(`products.form.notes${L}`)} htmlFor={`prod-notes-${l}`} error={msg(errs[`notes${L}`]?.message)}>
          <textarea id={`prod-notes-${l}`} dir={dir} lang={l} rows={2} className={areaCls} aria-invalid={!!errs[`notes${L}`]} {...register(`notes${L}`)} />
        </Field>
      </div>
    );
  };
  const cell = (name: FieldPath<ProductFormValues>, label: string, extra?: { hint?: string; id?: string }) => (
    <Field label={label} htmlFor={extra?.id ?? `prod-${name}`} error={msg(errs[name]?.message)} hint={extra?.hint}>
      <Input
        id={extra?.id ?? `prod-${name}`}
        dir="ltr"
        inputMode="decimal"
        aria-invalid={!!errs[name]}
        {...register(name, name === "slug" ? { onChange: () => setSlugTouched(true) } : undefined)}
      />
    </Field>
  );
  const sel = (name: "type" | "condition" | "status" | "categoryId", label: string, opts: { value: string; label: string }[], onChange?: (v: string) => void) => (
    <Field label={label} htmlFor={`prod-${name}`} error={msg(errs[name]?.message)}>
      <select
        id={`prod-${name}`}
        className={selectCls}
        aria-invalid={!!errs[name]}
        {...register(name, { onChange: (e) => onChange?.(e.target.value) })}
      >
        {name === "categoryId" && <option value="">{t("products.form.chooseCategory")}</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <section aria-labelledby="prod-edit-title">
      <button
        type="button"
        onClick={() => guard.go("/products")}
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
        {t("products.editor.back")}
      </button>
      <h1 id="prod-edit-title" className="font-display text-2xl font-semibold">
        {product ? t("products.editor.titleEdit") : t("products.editor.titleNew")}
      </h1>
      {stale && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm" data-testid="product-stale">
          <p>{t("products.editor.stale")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await onReload();
            }}
          >
            {t("products.editor.reload")}
          </Button>
        </div>
      )}
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="mt-4">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <div role="tablist" aria-label={t("products.form.languages")} className="flex border-b border-border">
              {tabBtn("ar", AR_FIELDS)}
              {tabBtn("en", EN_FIELDS)}
            </div>
            {panel("ar")}
            {panel("en")}
            <p className="mt-2 text-xs text-muted-foreground">{t("products.form.publishHint")}</p>
            <div className="mt-5">
              <p className="mb-1 text-sm font-medium">{t("products.form.images")}</p>
              <ImageUploader images={images} onChange={(fn) => setImages(fn)} max={MAX_IMAGES} showAlt testId="product-images" />
            </div>
          </div>
          <div>
            {cell("price", t("products.form.price"), { hint: t("products.form.moneyHint", { preview: preview(price) }) })}
            {cell("compareAtPrice", t("products.form.compareAt"), compare ? { hint: t("products.form.moneyHint", { preview: preview(compare) }) } : undefined)}
            {cell("stock", t("products.form.stock"))}
            {cell("sku", t("products.form.sku"))}
            {sel(
              "categoryId",
              t("products.form.category"),
              // Each child under its parent (QA B6), indented with an em dash.
              sortAsTree(cats.data ?? []).map((c) => ({ value: c.id, label: `${c.parentId ? "— " : ""}${c.name[locale]}` })),
            )}
            {sel(
              "type",
              t("products.form.type"),
              (["NEW", "RESALE"] as const).map((v) => ({ value: v, label: t(`products.type.${v}`) })),
              (v) => setValue("condition", v === "NEW" ? "NEW" : "LIKE_NEW", { shouldDirty: true }),
            )}
            {sel("condition", t("products.form.condition"), conditions.map((v) => ({ value: v, label: t(`products.condition.${v}`) })))}
            {cell("slug", t("products.form.slug"))}
            <fieldset className="mt-3">
              <legend className="mb-1 text-sm font-medium">{t("products.form.dimensions")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {cell("widthCm", t("products.form.widthCm"))}
                {cell("depthCm", t("products.form.depthCm"))}
                {cell("heightCm", t("products.form.heightCm"))}
                {cell("weightKg", t("products.form.weightKg"))}
              </div>
            </fieldset>
            {cell("material", t("products.form.material"))}
            {cell("color", t("products.form.color"))}
            {sel(
              "status",
              t("products.form.status"),
              (["DRAFT", "PUBLISHED", "ARCHIVED"] as const).map((v) => ({ value: v, label: t(`products.status.${v}`) })),
            )}
            <div className="mt-3 flex items-center gap-2">
              <input id="prod-featured" type="checkbox" className="size-4 accent-primary" {...register("isFeatured")} />
              <label htmlFor="prod-featured" className="text-sm">
                {t("products.form.featured")}
              </label>
            </div>
          </div>
        </div>
        {formError && (
          <p role="alert" className="mt-4 text-sm text-destructive" data-testid="product-form-error">
            {formError}
          </p>
        )}
        <div className="sticky bottom-0 mt-5 flex justify-end gap-2 border-t border-border bg-background py-3">
          <Button variant="outline" onClick={() => guard.go("/products")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} data-testid="product-save" data-status={status}>
            {t("common.save")}
          </Button>
        </div>
      </form>
      {guard.pending && (
        <Modal title={t("products.editor.unsavedTitle")} onClose={guard.stay} testId="unsaved-dialog">
          <p className="mt-3 text-sm">{t("products.editor.unsavedBody")}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={guard.stay}>
              {t("products.editor.stay")}
            </Button>
            <Button variant="destructive" onClick={guard.confirm} data-testid="unsaved-leave">
              {t("products.editor.leave")}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function ProductEditorPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useProduct(id);
  const [epoch, setEpoch] = useState(0);
  if (!id) return <ProductEditor product={null} onReload={async () => {}} />;
  if (q.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("products.editor.loading")}
      </p>
    );
  }
  if (q.isError || !q.data) {
    return (
      <p role="alert" className="text-destructive" data-testid="product-load-error">
        {q.error instanceof ApiError && q.error.code === "NOT_FOUND" ? t("products.editor.notFound") : errorMessage(t, locale, q.error)}
      </p>
    );
  }
  return (
    <ProductEditor
      key={`${q.data.id}-${q.data.updatedAt}-${epoch}`}
      product={q.data}
      onReload={async () => {
        await q.refetch();
        setEpoch((n) => n + 1);
      }}
    />
  );
}
