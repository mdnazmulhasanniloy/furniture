import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { FocalPicker } from "@/components/focal-picker";
import { HeroPreview, type Focal } from "@/components/hero-preview";
import {
  altState,
  ImageUploader,
  isUploading,
  storedImage,
  type UploaderImage,
} from "@/components/image-uploader";
import { Field } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import {
  bannerSchema,
  focalOf,
  isoToRiyadh,
  riyadhToIso,
  useBanners,
  useSaveBanner,
  type AdminBanner,
  type BannerFormValues,
  type BannerImageWrite,
  type BannerWrite,
} from "@/lib/banners";
import { toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

const CONTENT_EN = ["titleEn", "subtitleEn"] as const;
const CONTENT_AR = ["titleAr", "subtitleAr"] as const;

const imageWrite = (i: UploaderImage, focal: Focal): BannerImageWrite => ({
  key: i.key as string,
  alt: { en: i.alt.en.trim(), ar: i.alt.ar.trim() },
  ...(focal ? { focalX: focal.x, focalY: focal.y } : {}),
});
const sameImage = (a: BannerImageWrite, s?: AdminBanner["imageDesktop"] | null) =>
  !!s &&
  a.key === s.key &&
  a.alt.en === (s.alt?.en ?? "") &&
  a.alt.ar === (s.alt?.ar ?? "") &&
  (a.focalX ?? null) === (s.focalX ?? null) &&
  (a.focalY ?? null) === (s.focalY ?? null);

const card = "rounded-lg border border-border bg-card p-4";

function Editor({ banner, nextOrder, onReload }: { banner: AdminBanner | null; nextOrder: number; onReload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const navigate = useNavigate();
  const save = useSaveBanner();
  const [tab, setTab] = useState<"en" | "ar">(locale);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [desktop, setDesktop] = useState<UploaderImage[]>(() => (banner ? [storedImage(banner.imageDesktop)] : []));
  const [mobile, setMobile] = useState<UploaderImage[]>(() => (banner?.imageMobile ? [storedImage(banner.imageMobile)] : []));
  const [desktopFocal, setDesktopFocal] = useState<Focal>(() => focalOf(banner?.imageDesktop));
  const [mobileFocal, setMobileFocal] = useState<Focal>(() => focalOf(banner?.imageMobile));
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
      isActive: banner?.isActive ?? true,
    },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const v = watch();
  const L = tab === "en" ? "En" : "Ar";

  const onValid = async (values: BannerFormValues) => {
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
      title: { en: values.titleEn, ar: values.titleAr },
      subtitle: both(values.subtitleEn, values.subtitleAr),
      ctaLabel: both(values.ctaLabelEn, values.ctaLabelAr),
      ctaHref: values.ctaHref === "" ? null : values.ctaHref,
      startsAt: riyadhToIso(values.startsAt),
      endsAt: riyadhToIso(values.endsAt),
      isActive: values.isActive,
    };
    if (!banner) body.sortOrder = nextOrder; // a new banner goes last; the order is changed by dragging
    const dw = imageWrite(d, desktopFocal);
    if (!banner || !sameImage(dw, banner.imageDesktop)) body.imageDesktop = dw;
    if (m) {
      const mw = imageWrite(m, mobileFocal);
      if (!banner || !sameImage(mw, banner.imageMobile)) body.imageMobile = mw;
    } else if (banner?.imageMobile) body.imageMobile = null; // removed
    try {
      await save.mutateAsync({
        id: banner?.id,
        // Optimistic concurrency: the updatedAt we loaded (api-spec BannerPatch).
        body: banner ? { ...body, expectedUpdatedAt: banner.updatedAt } : body,
      });
      navigate("/banners");
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<BannerFormValues>) => {
    if (CONTENT_EN.some((f) => e[f]) && !CONTENT_AR.some((f) => e[f])) setTab("en");
    else if (CONTENT_AR.some((f) => e[f])) setTab("ar");
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
    const X = l === "en" ? "En" : "Ar";
    const dir = l === "en" ? "ltr" : "rtl";
    return (
      <div role="tabpanel" id={`ban-panel-${l}`} aria-labelledby={`ban-tab-${l}`} hidden={tab !== l}>
        <Field label={t(`banners.form.title${X}`)} htmlFor={`ban-title-${l}`} error={msg(errs[`title${X}`]?.message)}>
          <Input id={`ban-title-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`title${X}`]} {...register(`title${X}`)} />
        </Field>
        <Field label={t(`banners.form.subtitle${X}`)} htmlFor={`ban-sub-${l}`} error={msg(errs[`subtitle${X}`]?.message)}>
          <Input id={`ban-sub-${l}`} dir={dir} lang={l} aria-invalid={!!errs[`subtitle${X}`]} {...register(`subtitle${X}`)} />
        </Field>
      </div>
    );
  };

  const previewSrc = device === "mobile" ? (mobile[0]?.url ?? desktop[0]?.url ?? null) : (desktop[0]?.url ?? null);
  const previewFocal = device === "mobile" && mobile[0]?.url ? mobileFocal : desktopFocal;
  const Back = locale === "ar" ? ArrowRight : ArrowLeft;

  return (
    <section aria-labelledby="ban-editor-title" data-testid="banner-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/banners" className="inline-flex size-9 items-center justify-center rounded-md hover:bg-muted" aria-label={t("banners.title")}>
            <Back className="size-5" aria-hidden />
          </Link>
          <h1 id="ban-editor-title" className="font-display text-2xl font-semibold">
            {banner ? t("banners.edit") : t("banners.new")}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/banners")}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="banner-form" disabled={save.isPending} data-testid="banner-save">
            {t("common.save")}
          </Button>
        </div>
      </div>
      {stale && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm" data-testid="banner-stale">
          <p>{t("banners.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("banners.form.reload")}
          </Button>
        </div>
      )}
      <form id="banner-form" onSubmit={handleSubmit(onValid, onInvalid)} noValidate className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="space-y-4">
          <fieldset className={card} data-testid="banner-section-content">
            <legend className="px-1 text-base font-semibold">{t("banners.section.content")}</legend>
            <div role="tablist" aria-label={t("banners.form.languages")} className="flex border-b border-border">
              {tabBtn("ar", CONTENT_AR)}
              {tabBtn("en", CONTENT_EN)}
            </div>
            {panel("ar")}
            {panel("en")}
          </fieldset>

          <fieldset className={card} data-testid="banner-section-image">
            <legend className="px-1 text-base font-semibold">{t("banners.section.image")}</legend>
            <p className="mb-1 text-sm font-medium">{t("banners.form.imageDesktop")}</p>
            <ImageUploader
              images={desktop}
              onChange={(fn) => setDesktop(fn)}
              max={1}
              showAlt
              testId="banner-image-desktop"
              removeLabel={t("banners.form.removeDesktop")}
            />
            {desktop[0]?.url && (
              <FocalPicker src={desktop[0].url} value={desktopFocal} onChange={setDesktopFocal} testId="banner-focal-desktop" label={t("banners.form.cropDesktop")} />
            )}
            <p className="mt-1 text-xs text-muted-foreground" data-testid="banner-image-hint">
              {t("banners.form.imageHint")}
            </p>
            <p className="mb-1 mt-4 text-sm font-medium">{t("banners.form.imageMobile")}</p>
            <ImageUploader
              images={mobile}
              onChange={(fn) => setMobile(fn)}
              max={1}
              showAlt
              testId="banner-image-mobile"
              removeLabel={t("banners.form.removeMobile")}
            />
            {mobile[0]?.url && (
              <FocalPicker src={mobile[0].url} value={mobileFocal} onChange={setMobileFocal} testId="banner-focal-mobile" label={t("banners.form.cropMobile")} />
            )}
          </fieldset>

          <fieldset className={card} data-testid="banner-section-link">
            <legend className="px-1 text-base font-semibold">{t("banners.section.link")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("banners.form.ctaLabelAr")} htmlFor="ban-cta-ar" error={msg(errs.ctaLabelAr?.message)}>
                <Input id="ban-cta-ar" dir="rtl" lang="ar" aria-invalid={!!errs.ctaLabelAr} {...register("ctaLabelAr")} />
              </Field>
              <Field label={t("banners.form.ctaLabelEn")} htmlFor="ban-cta-en" error={msg(errs.ctaLabelEn?.message)}>
                <Input id="ban-cta-en" dir="ltr" lang="en" aria-invalid={!!errs.ctaLabelEn} {...register("ctaLabelEn")} />
              </Field>
            </div>
            <Field label={t("banners.form.ctaHref")} htmlFor="ban-href" error={msg(errs.ctaHref?.message)} hint={t("banners.form.ctaHrefHint")}>
              <Input id="ban-href" dir="ltr" aria-invalid={!!errs.ctaHref} {...register("ctaHref")} />
            </Field>
          </fieldset>

          <fieldset className={card} data-testid="banner-section-schedule">
            <legend className="px-1 text-base font-semibold">{t("banners.section.schedule")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("banners.form.startsAt")} htmlFor="ban-start" error={msg(errs.startsAt?.message)} hint={t("banners.form.scheduleHint")}>
                <Input id="ban-start" type="datetime-local" dir="ltr" aria-invalid={!!errs.startsAt} {...register("startsAt")} />
              </Field>
              <Field label={t("banners.form.endsAt")} htmlFor="ban-end" error={msg(errs.endsAt?.message)}>
                <Input id="ban-end" type="datetime-local" dir="ltr" aria-invalid={!!errs.endsAt} {...register("endsAt")} />
              </Field>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input id="ban-active" type="checkbox" className="size-4 accent-primary" {...register("isActive")} />
              <label htmlFor="ban-active" className="text-sm">
                {t("banners.form.active")}
              </label>
            </div>
          </fieldset>
          {formError && (
            <p role="alert" className="text-sm text-destructive" data-testid="banner-form-error">
              {formError}
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start" data-testid="banner-preview">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{t("banners.preview.title")}</h2>
            <div role="group" aria-label={t("banners.preview.title")} className="flex gap-1">
              {(["desktop", "mobile"] as const).map((d) => (
                <Button key={d} type="button" size="sm" variant={device === d ? "default" : "outline"} aria-pressed={device === d} onClick={() => setDevice(d)} data-testid={`banner-preview-${d}`}>
                  {t(`banners.preview.${d}`)}
                </Button>
              ))}
            </div>
          </div>
          <HeroPreview device={device} lang={tab} title={v[`title${L}`]} subtitle={v[`subtitle${L}`]} cta={v[`ctaLabel${L}`]} src={previewSrc} focal={previewFocal} />
        </aside>
      </form>
    </section>
  );
}

/** /banners/new and /banners/:id. The banner is read from the list (there is no GET by id). */
export function BannerEditorPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useBanners();
  const [epoch, setEpoch] = useState(0);
  if (q.isPending) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("banners.loading")}
      </p>
    );
  }
  if (q.isError) {
    return (
      <div className="flex items-center gap-3" data-testid="banners-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, q.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          {t("banners.retry")}
        </Button>
      </div>
    );
  }
  const all = q.data ?? [];
  const banner = id ? all.find((b) => b.id === id) : undefined;
  if (id && !banner) return <Navigate to="/banners" replace />;
  const nextOrder = all.reduce((m, b) => Math.max(m, b.sortOrder), 0) + 1;
  return (
    <Editor
      key={`${banner?.id ?? "new"}-${epoch}`}
      banner={banner ?? null}
      nextOrder={nextOrder}
      onReload={async () => {
        await q.refetch();
        setEpoch((e) => e + 1);
      }}
    />
  );
}
