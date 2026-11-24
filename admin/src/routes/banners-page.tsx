import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  altState,
  ImageUploader,
  isUploading,
  storedImage,
  type UploaderImage,
} from "@/components/image-uploader";
import { ArchCrop } from "@/components/arch-crop";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import {
  bannerSchema,
  bannerState,
  isoToRiyadh,
  riyadhToIso,
  useBanners,
  useDeleteBanner,
  useSaveBanner,
  type AdminBanner,
  type BannerFormValues,
  type BannerImageWrite,
  type BannerWrite,
} from "@/lib/banners";
import { formatDateTime, formatNumber, toLocale, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

const EN_FIELDS = ["titleEn", "subtitleEn", "ctaLabelEn"] as const;
const AR_FIELDS = ["titleAr", "subtitleAr", "ctaLabelAr"] as const;

const imageWrite = (i: UploaderImage): BannerImageWrite => ({
  key: i.key as string,
  alt: { en: i.alt.en.trim(), ar: i.alt.ar.trim() },
});
const sameImage = (a: BannerImageWrite, s?: AdminBanner["imageDesktop"] | null) =>
  !!s && a.key === s.key && a.alt.en === (s.alt?.en ?? "") && a.alt.ar === (s.alt?.ar ?? "");

function Preview({
  v,
  desktop,
  mobile,
  initial,
}: {
  v: BannerFormValues;
  desktop?: string | null;
  mobile?: string | null;
  initial: Locale;
}) {
  const { t } = useTranslation();
  const [lang, setLang] = useState<Locale>(initial);
  const L = lang === "en" ? "En" : "Ar";
  const title = v[`title${L}`];
  const subtitle = v[`subtitle${L}`];
  const cta = v[`ctaLabel${L}`];
  return (
    <div data-testid="banner-preview" className="mt-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-medium">{t("banners.form.preview")}</p>
        <div role="group" aria-label={t("banners.form.previewLang")} className="flex gap-1">
          {(["en", "ar"] as const).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={lang === l ? "default" : "outline"}
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
            >
              {l === "en" ? t("common.english") : t("common.arabic")}
            </Button>
          ))}
        </div>
      </div>
      {/* Mirrors the web hero: text on the start side, the image cropped from its centre into the 4:5 arch on the end side. */}
      <div
        dir={lang === "ar" ? "rtl" : "ltr"}
        lang={lang}
        data-testid="banner-preview-frame"
        className="flex items-center justify-between gap-4 bg-muted p-4"
      >
        <div className="min-w-0">
          <p className="font-display text-xl font-semibold" data-testid="banner-preview-title">
            {title}
          </p>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          {cta && (
            <span className="mt-3 inline-block rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">{cta}</span>
          )}
        </div>
        <div className="flex gap-3">
          {desktop && <ArchCrop src={desktop} label={t("banners.form.cropDesktop")} testId="banner-crop-desktop" />}
          {mobile && <ArchCrop src={mobile} label={t("banners.form.cropMobile")} testId="banner-crop-mobile" />}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="banner-crop-hint">
        {t("banners.form.cropHint")}
      </p>
    </div>
  );
}

function BannerForm({
  banner,
  onClose,
  onReload,
}: {
  banner: AdminBanner | null;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSaveBanner();
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [desktop, setDesktop] = useState<UploaderImage[]>(() => (banner ? [storedImage(banner.imageDesktop)] : []));
  const [mobile, setMobile] = useState<UploaderImage[]>(() =>
    banner?.imageMobile ? [storedImage(banner.imageMobile)] : [],
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const { register, handleSubmit, formState, watch } = useForm<BannerFormValues>({
    resolver: zodResolver(bannerSchema),
    defaultValues: {
      titleEn: banner?.title.en ?? "",
      titleAr: banner?.title.ar ?? "",
      subtitleEn: banner?.subtitle?.en ?? "",
      subtitleAr: banner?.subtitle?.ar ?? "",
      ctaLabelEn: banner?.ctaLabel?.en ?? "",
      ctaLabelAr: banner?.ctaLabel?.ar ?? "",
      ctaHref: banner?.ctaHref ?? "",
      startsAt: isoToRiyadh(banner?.startsAt),
      endsAt: isoToRiyadh(banner?.endsAt),
      sortOrder: String(banner?.sortOrder ?? 0),
      isActive: banner?.isActive ?? true,
    },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const values = watch();

  const onValid = async (v: BannerFormValues) => {
    setFormError(null);
    if (isUploading(desktop) || isUploading(mobile)) {
      setFormError(t("products.editor.uploadingWait"));
      return;
    }
    const d = desktop.find((i) => i.status === "done" && i.key);
    const m = mobile.find((i) => i.status === "done" && i.key);
    if (!d) {
      setFormError(t("banners.form.desktopRequired"));
      return;
    }
    // Alt text in both languages is required per image (UI-02, owner 2026-11-22).
    if (altState(d) !== "ok" || (m && altState(m) !== "ok")) {
      setFormError(t("banners.form.altRequired"));
      return;
    }
    const both = (en: string, ar: string) => (en && ar ? { en, ar } : null);
    const body: BannerWrite = {
      title: { en: v.titleEn, ar: v.titleAr },
      subtitle: both(v.subtitleEn, v.subtitleAr),
      ctaLabel: both(v.ctaLabelEn, v.ctaLabelAr),
      ctaHref: v.ctaHref === "" ? null : v.ctaHref,
      startsAt: riyadhToIso(v.startsAt),
      endsAt: riyadhToIso(v.endsAt),
      sortOrder: Number(v.sortOrder),
      isActive: v.isActive,
    };
    const dw = imageWrite(d);
    if (!banner || !sameImage(dw, banner.imageDesktop)) body.imageDesktop = dw;
    if (m) {
      const mw = imageWrite(m);
      if (!banner || !sameImage(mw, banner.imageMobile)) body.imageMobile = mw;
    } else if (banner?.imageMobile) body.imageMobile = null; // removed
    try {
      await save.mutateAsync({
        id: banner?.id,
        // Optimistic concurrency: the updatedAt we loaded (api-spec BannerPatch).
        body: banner ? { ...body, expectedUpdatedAt: banner.updatedAt } : body,
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<BannerFormValues>) => {
    if (EN_FIELDS.some((f) => e[f]) && !AR_FIELDS.some((f) => e[f])) setTab("en");
    else if (AR_FIELDS.some((f) => e[f])) setTab("ar");
  };
  const tabBtn = (l: "en" | "ar", fields: readonly (keyof BannerFormValues)[]) => {
    const hasErr = fields.some((f) => errs[f]);
    return (
      <button
        type="button"
        role="tab"
        id={`ban-tab-${l}`}
        aria-selected={tab === l}
        aria-controls={`ban-panel-${l}`}
        onClick={() => setTab(l)}
        className={cn(
          "h-9 border-b-2 px-3 text-sm",
          tab === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
          hasErr && "text-destructive",
        )}
      >
        {l === "en" ? t("common.english") : t("common.arabic")}
        {hasErr && <span className="sr-only"> ({t("banners.form.hasErrors")})</span>}
      </button>
    );
  };
  const panel = (l: "en" | "ar") => {
    const L = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    return (
      <div role="tabpanel" id={`ban-panel-${l}`} aria-labelledby={`ban-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`banners.form.title${L}`)} htmlFor={`ban-title-${l}`} error={msg(errs[`title${L}`]?.message)}>
          <Input id={`ban-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`title${L}`]} {...register(`title${L}`)} />
        </Field>
        <Field label={t(`banners.form.subtitle${L}`)} htmlFor={`ban-sub-${l}`} error={msg(errs[`subtitle${L}`]?.message)}>
          <Input id={`ban-sub-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`subtitle${L}`]} {...register(`subtitle${L}`)} />
        </Field>
        <Field label={t(`banners.form.ctaLabel${L}`)} htmlFor={`ban-cta-${l}`} error={msg(errs[`ctaLabel${L}`]?.message)}>
          <Input id={`ban-cta-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`ctaLabel${L}`]} {...register(`ctaLabel${L}`)} />
        </Field>
      </div>
    );
  };

  return (
    <Modal title={banner ? t("banners.edit") : t("banners.new")} onClose={onClose} testId="banner-dialog" wide>
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="banner-stale"
        >
          <p>{t("banners.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("banners.form.reload")}
          </Button>
        </div>
      )}
      <form onSubmit={handleSubmit(onValid, onInvalid)} noValidate>
        <div role="tablist" aria-label={t("banners.form.languages")} className="mt-3 flex border-b border-border">
          {tabBtn("ar", AR_FIELDS)}
          {tabBtn("en", EN_FIELDS)}
        </div>
        {panel("ar")}
        {panel("en")}
        <Field
          label={t("banners.form.ctaHref")}
          htmlFor="ban-href"
          error={msg(errs.ctaHref?.message)}
          hint={t("banners.form.ctaHrefHint")}
        >
          <Input id="ban-href" dir="ltr" aria-invalid={!!errs.ctaHref} {...register("ctaHref")} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("banners.form.startsAt")}
            htmlFor="ban-start"
            error={msg(errs.startsAt?.message)}
            hint={t("banners.form.scheduleHint")}
          >
            <Input id="ban-start" type="datetime-local" dir="ltr" aria-invalid={!!errs.startsAt} {...register("startsAt")} />
          </Field>
          <Field label={t("banners.form.endsAt")} htmlFor="ban-end" error={msg(errs.endsAt?.message)}>
            <Input id="ban-end" type="datetime-local" dir="ltr" aria-invalid={!!errs.endsAt} {...register("endsAt")} />
          </Field>
        </div>
        <Field label={t("banners.form.sortOrder")} htmlFor="ban-sort" error={msg(errs.sortOrder?.message)}>
          <Input id="ban-sort" inputMode="numeric" dir="ltr" aria-invalid={!!errs.sortOrder} {...register("sortOrder")} />
        </Field>
        <div className="mt-3 flex items-center gap-2">
          <input id="ban-active" type="checkbox" className="size-4 accent-primary" {...register("isActive")} />
          <label htmlFor="ban-active" className="text-sm">
            {t("banners.form.active")}
          </label>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">{t("banners.form.imageDesktop")}</p>
          <ImageUploader
            images={desktop}
            onChange={(fn) => setDesktop(fn)}
            max={1}
            showAlt
            testId="banner-image-desktop"
            removeLabel={t("banners.form.removeDesktop")}
          />
          <p className="mt-1 text-xs text-muted-foreground" data-testid="banner-image-hint">
            {t("banners.form.imageHint")}
          </p>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">{t("banners.form.imageMobile")}</p>
          <ImageUploader
            images={mobile}
            onChange={(fn) => setMobile(fn)}
            max={1}
            showAlt
            testId="banner-image-mobile"
            removeLabel={t("banners.form.removeMobile")}
          />
        </div>
        <Preview v={values} desktop={desktop[0]?.url} mobile={mobile[0]?.url} initial={locale} />
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="banner-form-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={save.isPending} data-testid="banner-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({ banner, onClose }: { banner: AdminBanner; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const del = useDeleteBanner();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t("banners.deleteTitle")} onClose={onClose} testId="banner-delete-dialog">
      <p className="mt-3 text-sm">{t("banners.deleteBody", { name: banner.title[locale] })}</p>
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

export function BannersPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useBanners();
  const toggle = useSaveBanner();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [deleting, setDeleting] = useState<AdminBanner | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const all = [...(q.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const current = editing && editing !== "new" ? all.find((b) => b.id === editing) : undefined;

  return (
    <section aria-labelledby="ban-title">
      <div className="flex items-center justify-between gap-3">
        <h1 id="ban-title" className="font-display text-2xl font-semibold">
          {t("banners.title")}
        </h1>
        <Button onClick={() => setEditing("new")} disabled={!q.isSuccess} data-testid="banner-new">
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
        <p className="mt-4 text-muted-foreground" data-testid="banners-empty">
          {t("banners.empty")}
        </p>
      )}
      {q.isSuccess && all.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="banners-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["image", "title", "schedule", "sort", "status", "active", "actions"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`banners.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map((b) => {
                const name = b.title[locale];
                const st = bannerState(b);
                return (
                  <tr key={b.id} className="border-t border-border" data-testid="banner-row">
                    <td className="px-3 py-2 text-start">
                      <img
                        src={b.imageDesktop.url}
                        alt={b.imageDesktop.alt?.[locale] ?? ""}
                        className="h-10 w-20 rounded object-cover"
                      />
                      {b.imageMobile && (
                        <span className="mt-1 block text-xs text-muted-foreground" data-testid="banner-has-mobile">
                          {t("banners.hasMobile")}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-start font-medium">
                      {name}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {b.title[locale === "ar" ? "en" : "ar"]}
                      </span>
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
                    <td className="px-3 py-2 text-start">{formatNumber(b.sortOrder, locale)}</td>
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
                        disabled={toggle.isPending}
                        onClick={async () => {
                          setRowError(null);
                          try {
                            await toggle.mutateAsync({
                              id: b.id,
                              body: { isActive: !b.isActive, expectedUpdatedAt: b.updatedAt },
                            });
                          } catch (e) {
                            setRowError(errorMessage(t, locale, e));
                            void q.refetch();
                          }
                        }}
                        className={cn(
                          "inline-flex h-6 w-11 items-center rounded-full border border-border px-0.5 transition-colors",
                          b.isActive ? "bg-primary" : "bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "size-4 rounded-full bg-card transition-transform",
                            b.isActive && "translate-x-5 rtl:-translate-x-5",
                          )}
                        />
                      </button>
                    </td>
                    <td className="px-3 py-2 text-start">
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("banners.editNamed", { name })}
                          onClick={() => setEditing(b.id)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t("banners.deleteNamed", { name })}
                          onClick={() => setDeleting(b)}
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
      {editing === "new" && <BannerForm banner={null} onClose={() => setEditing(null)} onReload={async () => {}} />}
      {current && (
        <BannerForm
          key={`${current.id}-${epoch}`}
          banner={current}
          onClose={() => setEditing(null)}
          onReload={async () => {
            await q.refetch();
            setEpoch((e) => e + 1);
          }}
        />
      )}
      {deleting && <DeleteDialog banner={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}
