import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ImageUploader, isUploading, storedImage, type UploaderImage } from "@/components/image-uploader";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import {
  categorySchema,
  slugify,
  useCategories,
  useDeleteCategory,
  useSaveCategory,
  sortAsTree,
  type AdminCategory,
  type CategoryFormValues,
} from "@/lib/categories";
import { formatNumber, toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

function CategoryForm({
  category,
  all,
  onClose,
}: {
  category: AdminCategory | null;
  all: AdminCategory[];
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSaveCategory();
  const [tab, setTab] = useState<"en" | "ar">("en");
  // Image field (ADR-010 uploader): the stored image is kept unless replaced or removed.
  const [images, setImages] = useState<UploaderImage[]>(() => (category?.image ? [storedImage(category.image as Parameters<typeof storedImage>[0])] : []));
  const [slugTouched, setSlugTouched] = useState(!!category);
  const [formError, setFormError] = useState<string | null>(null);
  const hasChildren = !!category && all.some((c) => c.parentId === category.id);
  // One level only (CAT-01): a parent must be a root, never the category itself.
  const parents = all.filter((c) => c.parentId === null && c.id !== category?.id);
  const { register, handleSubmit, formState, setValue, watch } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      nameEn: category?.name.en ?? "",
      nameAr: category?.name.ar ?? "",
      slug: category?.slug ?? "",
      parentId: category?.parentId ?? "",
      sortOrder: String(category?.sortOrder ?? 0),
      isActive: category?.isActive ?? true,
    },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const nameEn = watch("nameEn");
  useEffect(() => {
    if (!slugTouched) setValue("slug", slugify(nameEn));
  }, [nameEn, slugTouched, setValue]);

  const onValid = async (v: CategoryFormValues) => {
    setFormError(null);
    if (isUploading(images)) {
      setFormError(t("products.editor.uploadingWait"));
      return;
    }
    const picked = images.find((i) => i.status === "done" && i.key);
    const imageChange = !picked
      ? category?.image
        ? { image: null }
        : {}
      : picked.key !== category?.image?.key
        ? { image: { key: picked.key as string } }
        : {};
    const body = {
      name: { en: v.nameEn, ar: v.nameAr },
      slug: v.slug,
      parentId: v.parentId || null,
      sortOrder: Number(v.sortOrder),
      isActive: v.isActive,
      ...imageChange,
    };
    try {
      await save.mutateAsync({ id: category?.id, body });
      onClose();
    } catch (e) {
      setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<CategoryFormValues>) => {
    if (e.nameEn) setTab("en");
    else if (e.nameAr) setTab("ar");
  };
  const tabBtn = (l: "en" | "ar", hasErr: boolean) => (
    <button
      type="button"
      role="tab"
      id={`cat-tab-${l}`}
      aria-selected={tab === l}
      aria-controls={`cat-panel-${l}`}
      onClick={() => setTab(l)}
      className={cn(
        "h-9 border-b-2 px-3 text-sm",
        tab === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
        hasErr && "text-destructive",
      )}
    >
      {l === "en" ? t("common.english") : t("common.arabic")}
      {hasErr && <span className="sr-only"> ({t("categories.form.hasErrors")})</span>}
    </button>
  );
  return (
    <Modal title={category ? t("categories.edit") : t("categories.new")} onClose={onClose} testId="category-dialog">
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
        <div role="tablist" aria-label={t("categories.form.languages")} className="mt-3 flex border-b border-border">
          {tabBtn("en", !!errs.nameEn)}
          {tabBtn("ar", !!errs.nameAr)}
        </div>
        <div role="tabpanel" id="cat-panel-en" aria-labelledby="cat-tab-en" hidden={tab !== "en"}>
          <Field label={t("categories.form.nameEn")} htmlFor="cat-name-en" error={msg(errs.nameEn?.message)}>
            <Input id="cat-name-en" dir="ltr" lang="en" aria-invalid={!!errs.nameEn} {...register("nameEn")} />
          </Field>
        </div>
        <div role="tabpanel" id="cat-panel-ar" aria-labelledby="cat-tab-ar" hidden={tab !== "ar"}>
          <Field label={t("categories.form.nameAr")} htmlFor="cat-name-ar" error={msg(errs.nameAr?.message)}>
            <Input id="cat-name-ar" dir="rtl" lang="ar" aria-invalid={!!errs.nameAr} {...register("nameAr")} />
          </Field>
        </div>
        <Field label={t("categories.form.slug")} htmlFor="cat-slug" error={msg(errs.slug?.message)}>
          <Input
            id="cat-slug"
            dir="ltr"
            aria-invalid={!!errs.slug}
            {...register("slug", { onChange: () => setSlugTouched(true) })}
          />
        </Field>
        <Field label={t("categories.form.parent")} htmlFor="cat-parent">
          <select
            id="cat-parent"
            disabled={hasChildren}
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-card-foreground disabled:opacity-50"
            {...register("parentId")}
          >
            <option value="">{t("categories.form.noParent")}</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name[locale]}
              </option>
            ))}
          </select>
          {hasChildren && <p className="mt-1 text-xs text-muted-foreground">{t("categories.form.hasChildrenHint")}</p>}
        </Field>
        <Field label={t("categories.form.sortOrder")} htmlFor="cat-sort" error={msg(errs.sortOrder?.message)}>
          <Input id="cat-sort" inputMode="numeric" dir="ltr" aria-invalid={!!errs.sortOrder} {...register("sortOrder")} />
        </Field>
        <div className="mt-3 flex items-center gap-2">
          <input id="cat-active" type="checkbox" className="size-4 accent-primary" {...register("isActive")} />
          <label htmlFor="cat-active" className="text-sm">
            {t("categories.form.active")}
          </label>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">{t("categories.form.image")}</p>
          <ImageUploader
            images={images}
            onChange={(fn) => setImages(fn)}
            max={1}
            testId="category-image"
            removeLabel={t("categories.form.removeImage")}
          />
        </div>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="category-form-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ category, onClose }: { category: AdminCategory; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeleteCategory();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("categories.deleteTitle")} onClose={onClose} testId="category-delete-dialog">
      <p className="mt-3 text-sm">{t("categories.deleteBody", { name: category.name[locale] })}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="category-delete-error">
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
          data-testid="category-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(category.id);
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

export function CategoriesPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useCategories();
  const toggle = useSaveCategory();
  const [editing, setEditing] = useState<AdminCategory | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  // Parents first, each followed by its children (QA B6), not the API's flat sortOrder order.
  const all = sortAsTree(q.data ?? []);
  const byId = new Map(all.map((c) => [c.id, c]));

  return (
    <section aria-labelledby="cat-title">
      <div className="flex items-center justify-between gap-3">
        <h1 id="cat-title" className="font-display text-2xl font-semibold">
          {t("categories.title")}
        </h1>
        <Button onClick={() => setEditing("new")} disabled={!q.isSuccess} data-testid="category-new">
          <Plus className="size-4" aria-hidden />
          {t("categories.new")}
        </Button>
      </div>
      {q.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("categories.loading")}
        </p>
      )}
      {q.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="categories-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, q.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("categories.retry")}
          </Button>
        </div>
      )}
      {rowError && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="categories-row-error">
          {rowError}
        </p>
      )}
      {q.isSuccess && all.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="categories-empty">
          {t("categories.empty")}
        </p>
      )}
      {q.isSuccess && all.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="categories-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["name", "slug", "parent", "products", "sort", "active", "actions"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`categories.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map((c) => {
                const hasChildren = all.some((x) => x.parentId === c.id);
                const count = c.productCount ?? 0;
                const parent = c.parentId ? byId.get(c.parentId) : undefined;
                const name = c.name[locale];
                return (
                  <tr key={c.id} className="border-t border-border" data-testid="category-row">
                    <td className="px-3 py-2 text-start font-medium">
                      <span className={cn(c.parentId && "ps-4")}>{name}</span>
                      <span className="block text-xs font-normal text-muted-foreground">
                        {c.name[locale === "ar" ? "en" : "ar"]}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-start">
                      <bdi dir="ltr">{c.slug}</bdi>
                    </td>
                    <td className="px-3 py-2 text-start">{parent ? parent.name[locale] : "—"}</td>
                    <td className="px-3 py-2 text-start">{formatNumber(count, locale)}</td>
                    <td className="px-3 py-2 text-start">{formatNumber(c.sortOrder, locale)}</td>
                    <td className="px-3 py-2 text-start">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={c.isActive}
                        aria-label={t("categories.toggleActive", { name })}
                        disabled={toggle.isPending}
                        onClick={async () => {
                          setRowError(null);
                          try {
                            await toggle.mutateAsync({ id: c.id, body: { isActive: !c.isActive } });
                          } catch (e) {
                            setRowError(errorMessage(t, locale, e));
                          }
                        }}
                        className={cn(
                          "inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors",
                          c.isActive ? "bg-primary" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded-full bg-card transition-transform",
                            c.isActive && "translate-x-5 rtl:-translate-x-5",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-start">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("categories.editNamed", { name })}
                          onClick={() => setEditing(c)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        {/* Delete is offered only when the API would allow it; the API stays the authority (409 handled). */}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("categories.deleteNamed", { name })}
                          disabled={count > 0 || hasChildren}
                          title={
                            count > 0
                              ? t("categories.blockedProducts")
                              : hasChildren
                                ? t("categories.blockedChildren")
                                : undefined
                          }
                          onClick={() => setDeleting(c)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <CategoryForm category={editing === "new" ? null : editing} all={all} onClose={() => setEditing(null)} />
      )}
      {deleting && <DeleteDialog category={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
