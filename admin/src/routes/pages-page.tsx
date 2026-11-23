import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Controller, useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Field, Modal } from "@/components/modal";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { toLocale } from "@/lib/format";
import {
  pageSchema,
  useDeletePage,
  usePages,
  useSavePage,
  type AdminPage,
  type PageFormValues,
  type PageWrite,
} from "@/lib/pages";
import { cn } from "@/lib/utils";

const EN_FIELDS = ["titleEn", "contentEn"] as const;
const AR_FIELDS = ["titleAr", "contentAr"] as const;

function PageForm({
  page,
  onClose,
  onReload,
}: {
  page: AdminPage | null;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSavePage();
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const { register, control, handleSubmit, formState } = useForm<PageFormValues>({
    resolver: zodResolver(pageSchema),
    defaultValues: {
      slug: page?.slug ?? "",
      titleEn: page?.title.en ?? "",
      titleAr: page?.title.ar ?? "",
      contentEn: page?.content.en ?? "",
      contentAr: page?.content.ar ?? "",
      isPublished: page?.isPublished ?? false,
    },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);

  const onValid = async (v: PageFormValues) => {
    setFormError(null);
    const body: PageWrite = {
      slug: v.slug,
      title: { en: v.titleEn, ar: v.titleAr },
      content: { en: v.contentEn, ar: v.contentAr },
      isPublished: v.isPublished,
    };
    if (page) body.expectedUpdatedAt = page.updatedAt; // optimistic concurrency (api-spec PagePatch)
    try {
      await save.mutateAsync({ id: page?.id, body });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<PageFormValues>) => {
    const en = EN_FIELDS.some((f) => e[f]);
    const ar = AR_FIELDS.some((f) => e[f]);
    if (en && !ar) setTab("en");
    else if (ar) setTab("ar");
  };
  const tabBtn = (l: "en" | "ar", fields: readonly (keyof PageFormValues)[]) => {
    const hasErr = fields.some((f) => errs[f]);
    return (
      <button
        type="button"
        role="tab"
        id={`page-tab-${l}`}
        aria-selected={tab === l}
        aria-controls={`page-panel-${l}`}
        onClick={() => setTab(l)}
        className={cn(
          "h-9 border-b-2 px-3 text-sm",
          tab === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
          hasErr && "text-destructive",
        )}
      >
        {l === "en" ? t("common.english") : t("common.arabic")}
        {hasErr && <span className="sr-only"> ({t("pages.form.hasErrors")})</span>}
      </button>
    );
  };
  const panel = (l: "en" | "ar") => {
    const L = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    const titleKey = `title${L}` as const;
    const contentKey = `content${L}` as const;
    return (
      <div role="tabpanel" id={`page-panel-${l}`} aria-labelledby={`page-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`pages.form.title${L}`)} htmlFor={`page-title-${l}`} error={msg(errs[titleKey]?.message)}>
          <Input id={`page-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[titleKey]} {...register(titleKey)} />
        </Field>
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium" id={`page-content-label-${l}`}>
            {t(`pages.form.content${L}`)}
          </p>
          <Controller
            control={control}
            name={contentKey}
            render={({ field }) => (
              <RichTextEditor
                id={`page-content-${l}`}
                label={t(`pages.form.content${L}`)}
                value={field.value}
                onChange={field.onChange}
                dir={dir}
                lang={l}
                invalid={!!errs[contentKey]}
              />
            )}
          />
          {errs[contentKey] && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {t(errs[contentKey]?.message ?? "")}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <Modal title={page ? t("pages.edit") : t("pages.new")} onClose={onClose} testId="page-dialog" wide>
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="page-stale"
        >
          <p>{t("pages.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("pages.form.reload")}
          </Button>
        </div>
      )}
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
        <Field label={t("pages.form.slug")} htmlFor="page-slug" error={msg(errs.slug?.message)} hint={t("pages.form.slugHint")}>
          <Input id="page-slug" dir="ltr" aria-invalid={!!errs.slug} {...register("slug")} />
        </Field>
        <div role="tablist" aria-label={t("pages.form.languages")} className="mt-3 flex border-b border-border">
          {tabBtn("ar", AR_FIELDS)}
          {tabBtn("en", EN_FIELDS)}
        </div>
        {panel("ar")}
        {panel("en")}
        <div className="mt-3 flex items-center gap-2">
          <input id="page-published" type="checkbox" className="size-4 accent-primary" {...register("isPublished")} />
          <label htmlFor="page-published" className="text-sm">
            {t("pages.form.published")}
          </label>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t("pages.form.publishHint")}</p>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="page-form-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} data-testid="page-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ page, onClose }: { page: AdminPage; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeletePage();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("pages.deleteTitle")} onClose={onClose} testId="page-delete-dialog">
      <p className="mt-3 text-sm">{t("pages.deleteBody", { name: page.title[locale] || page.slug })}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="page-delete-error">
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
          data-testid="page-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(page.id);
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

export function PagesPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = usePages();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminPage | null>(null);
  const [epoch, setEpoch] = useState(0);
  const all = q.data ?? [];
  const current = editing && editing !== "new" ? (all.find((p) => p.id === editing) ?? null) : null;

  return (
    <section aria-labelledby="pages-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="pages-title" className="font-display text-2xl font-semibold">
          {t("pages.title")}
        </h1>
        <Button onClick={() => setEditing("new")} data-testid="page-new">
          <Plus className="size-4" aria-hidden /> {t("pages.new")}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t("pages.hint")}</p>
      {q.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("pages.loading")}
        </p>
      )}
      {q.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="pages-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, q.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("pages.retry")}
          </Button>
        </div>
      )}
      {q.isSuccess && all.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="pages-empty">
          {t("pages.empty")}
        </p>
      )}
      {q.isSuccess && all.length > 0 && (
        <ul className="mt-4 overflow-hidden rounded-lg border border-border" data-testid="pages-list">
          {all.map((p) => {
            const name = p.title[locale] || p.title[locale === "ar" ? "en" : "ar"] || p.slug;
            return (
              <li
                key={p.id}
                data-testid="page-row"
                data-id={p.id}
                className="flex flex-wrap items-center gap-3 border-t border-border bg-card px-3 py-2 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{name}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    /{p.slug}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    p.isPublished ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                  )}
                  data-testid="page-state"
                >
                  {p.isPublished ? t("pages.published") : t("pages.draft")}
                </span>
                <Button variant="ghost" size="icon" aria-label={t("pages.editNamed", { name })} onClick={() => setEditing(p.id)}>
                  <Pencil className="size-4" aria-hidden />
                </Button>
                <Button variant="ghost" size="icon" aria-label={t("pages.deleteNamed", { name })} onClick={() => setDeleting(p)}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (editing === "new" || current) && (
        <PageForm
          key={`${editing}-${epoch}`}
          page={current}
          onClose={() => setEditing(null)}
          onReload={async () => {
            await q.refetch();
            setEpoch((e) => e + 1);
          }}
        />
      )}
      {deleting && <DeleteDialog page={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
