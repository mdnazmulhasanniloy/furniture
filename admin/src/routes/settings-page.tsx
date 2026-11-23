import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, type FieldErrors } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { altState, ImageUploader, isUploading, storedImage, type UploaderImage } from "@/components/image-uploader";
import { Field } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { toLocale } from "@/lib/format";
import {
  buildSettingsBody,
  formToEdit,
  settingsDefaults,
  settingsSchema,
  useSaveSettings,
  useSettings,
  type SettingsFormValues,
  type SiteSettings,
} from "@/lib/settings";
import { activeCount, cityErrors, rowsToCities, toRows, type CityRow } from "@/lib/delivery";
import { DeliveryPanel } from "@/routes/settings-delivery";
import { VatPanel } from "@/routes/settings-vat";
import { cn } from "@/lib/utils";

type Section = "general" | "delivery" | "vat" | "social" | "seo";
type Lang = "ar" | "en";
const SOCIALS = ["facebook", "instagram", "whatsapp", "tiktok"] as const;

const GENERAL_FIELDS = ["storeNameEn", "storeNameAr", "addressEn", "addressAr", "contactEmail", "defaultLocale"] as const;
const DELIVERY_FIELDS = ["deliveryFee", "freeThreshold"] as const;
const VAT_FIELDS = ["vatRate", "vatNumber"] as const;
const SEO_FIELDS = ["seoTitleEn", "seoTitleAr", "seoDescEn", "seoDescAr"] as const;

function LangTabs({
  id,
  lang,
  setLang,
  errs,
}: {
  id: string;
  lang: Lang;
  setLang: (l: Lang) => void;
  errs: Record<Lang, boolean>;
}) {
  const { t } = useTranslation();
  return (
    <div role="tablist" aria-label={t("settings.form.languages")} className="mt-3 flex border-b border-border">
      {(["ar", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="tab"
          id={`${id}-tab-${l}`}
          aria-selected={lang === l}
          aria-controls={`${id}-panel-${l}`}
          onClick={() => setLang(l)}
          className={cn(
            "h-9 border-b-2 px-3 text-sm",
            lang === l ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
            errs[l] && "text-destructive",
          )}
        >
          {l === "en" ? t("common.english") : t("common.arabic")}
          {errs[l] && <span className="sr-only"> ({t("settings.form.hasErrors")})</span>}
        </button>
      ))}
    </div>
  );
}

function SettingsForm({ settings, onReload }: { settings: SiteSettings; onReload: () => Promise<void> }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const save = useSaveSettings();
  const [section, setSection] = useState<Section>("general");
  const [lang, setLang] = useState<Lang>(locale);
  const [logo, setLogo] = useState<UploaderImage[]>(() => (settings.logo ? [storedImage(settings.logo)] : []));
  const [formError, setFormError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState<CityRow[]>(() => toRows(settings.deliveryCities));
  const [tried, setTried] = useState(false);
  const { register, handleSubmit, formState, watch, setValue } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: settingsDefaults(settings),
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const langErr = (f: readonly (keyof SettingsFormValues)[]) => ({
    en: f.some((k) => k.endsWith("En") && errs[k]),
    ar: f.some((k) => k.endsWith("Ar") && errs[k]),
  });

  const onValid = async (v: SettingsFormValues) => {
    setFormError(null);
    setSaved(false);
    if (isUploading(logo)) {
      setFormError(t("products.editor.uploadingWait"));
      return;
    }
    const l = logo.find((i) => i.status === "done" && i.key);
    if (l && altState(l) === "partial") {
      setFormError(t("settings.form.logoAltBoth"));
      return;
    }
    const logoWrite = l
      ? altState(l) === "ok"
        ? { key: l.key as string, alt: { en: l.alt.en.trim(), ar: l.alt.ar.trim() } }
        : { key: l.key as string }
      : null;
    if (cityErrors(rows).some(Boolean)) {
      setSection("delivery");
      return;
    }
    if (activeCount(rows) < 1) {
      setSection("delivery");
      setFormError(t("settings.delivery.noActive"));
      return;
    }
    try {
      await save.mutateAsync(buildSettingsBody(settings, formToEdit(v, logoWrite, rowsToCities(rows), settings)));
      setSaved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "STALE_UPDATE") setStale(true);
      else setFormError(errorMessage(t, locale, e));
    }
  };
  const onInvalid = (e: FieldErrors<SettingsFormValues>) => {
    if (GENERAL_FIELDS.some((f) => e[f])) setSection("general");
    else if (DELIVERY_FIELDS.some((f) => e[f])) setSection("delivery");
    else if (VAT_FIELDS.some((f) => e[f])) setSection("vat");
    else if (SEO_FIELDS.some((f) => e[f])) setSection("seo");
    const pool = [...GENERAL_FIELDS, ...SEO_FIELDS].filter((f) => e[f]);
    if (pool.some((f) => f.endsWith("Ar"))) setLang("ar");
    else if (pool.some((f) => f.endsWith("En"))) setLang("en");
  };

  const sectionBtn = (s: Section, fields: readonly (keyof SettingsFormValues)[]) => (
    <button
      key={s}
      type="button"
      role="tab"
      id={`set-tab-${s}`}
      aria-selected={section === s}
      aria-controls={`set-panel-${s}`}
      onClick={() => setSection(s)}
      className={cn(
        "h-9 border-b-2 px-3 text-sm",
        section === s ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground",
        fields.some((f) => errs[f]) && "text-destructive",
      )}
    >
      {t(`settings.section.${s}`)}
    </button>
  );

  const localized = (prefix: string, rows: { base: string; label: string; textarea?: boolean }[]) =>
    (["ar", "en"] as const).map((l) => (
      <div key={l} role="tabpanel" id={`${prefix}-panel-${l}`} aria-labelledby={`${prefix}-tab-${l}`} hidden={lang !== l}>
        {rows.map((r) => {
          const suffix = l === "en" ? "En" : "Ar";
          const name = `${r.base}${suffix}` as keyof SettingsFormValues;
          const id = `${prefix}-${r.base}-${l}`;
          const common = {
            id,
            dir: l === "en" ? "ltr" : "rtl",
            lang: l,
            "aria-invalid": !!errs[name],
            ...register(name),
          } as const;
          return (
            <Field key={name} label={t(`settings.form.${r.label}${suffix}`)} htmlFor={id} error={msg(errs[name]?.message)}>
              {r.textarea ? (
                <textarea {...common} rows={3} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
              ) : (
                <Input {...common} />
              )}
            </Field>
          );
        })}
      </div>
    ));

  return (
    <form
      onSubmit={(e) => {
        setTried(true);
        return handleSubmit(onValid, onInvalid)(e);
      }} noValidate data-testid="settings-form">
      {stale && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-destructive p-3 text-sm"
          data-testid="settings-stale"
        >
          <p>{t("settings.form.stale")}</p>
          <Button variant="outline" size="sm" onClick={() => void onReload()}>
            {t("settings.form.reload")}
          </Button>
        </div>
      )}
      <div role="tablist" aria-label={t("settings.sections")} className="mt-4 flex border-b border-border">
        {sectionBtn("general", GENERAL_FIELDS)}
        {sectionBtn("delivery", DELIVERY_FIELDS)}
        {sectionBtn("vat", VAT_FIELDS)}
        {sectionBtn("social", [])}
        {sectionBtn("seo", SEO_FIELDS)}
      </div>

      <div role="tabpanel" id="set-panel-general" aria-labelledby="set-tab-general" hidden={section !== "general"}>
        <LangTabs id="gen" lang={lang} setLang={setLang} errs={langErr(["storeNameEn", "storeNameAr", "addressEn", "addressAr"])} />
        {localized("gen", [
          { base: "storeName", label: "storeName" },
          { base: "address", label: "address", textarea: true },
        ])}
        <Field label={t("settings.form.contactEmail")} htmlFor="set-email" error={msg(errs.contactEmail?.message)}>
          <Input id="set-email" type="email" dir="ltr" aria-invalid={!!errs.contactEmail} {...register("contactEmail")} />
        </Field>
        <Field label={t("settings.form.contactPhone")} htmlFor="set-phone" hint={t("settings.form.phoneBlocked")}>
          <Input id="set-phone" dir="ltr" value={settings.contactPhone} readOnly data-testid="settings-phone" />
        </Field>
        <Field label={t("settings.form.defaultLocale")} htmlFor="set-locale" hint={t("settings.form.defaultLocaleHint")}>
          <select
            id="set-locale"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            {...register("defaultLocale")}
          >
            <option value="ar">{t("common.arabic")}</option>
            <option value="en">{t("common.english")}</option>
          </select>
        </Field>
        <Field label={t("settings.form.currency")} htmlFor="set-currency" hint={t("settings.form.currencyHint")}>
          <Input id="set-currency" dir="ltr" value="SAR" readOnly data-testid="settings-currency" />
        </Field>
        <div className="mt-3">
          <p className="mb-1 text-sm font-medium">{t("settings.form.logo")}</p>
          <ImageUploader
            images={logo}
            onChange={(fn) => setLogo(fn)}
            max={1}
            showAlt
            testId="settings-logo"
            removeLabel={t("settings.form.removeLogo")}
          />
        </div>
      </div>

      <div role="tabpanel" id="set-panel-delivery" aria-labelledby="set-tab-delivery" hidden={section !== "delivery"}>
        <DeliveryPanel register={register} errs={errs} rows={rows} setRows={setRows} showErrors={tried} />
      </div>

      <div role="tabpanel" id="set-panel-vat" aria-labelledby="set-tab-vat" hidden={section !== "vat"}>
        <VatPanel register={register} errs={errs} watch={watch} setValue={setValue} />
      </div>

      <div role="tabpanel" id="set-panel-social" aria-labelledby="set-tab-social" hidden={section !== "social"}>
        <p className="mt-3 text-sm text-muted-foreground" data-testid="settings-social-blocked">
          {t("settings.form.socialBlocked")}
        </p>
        {SOCIALS.map((k) => (
          <Field key={k} label={t(`settings.social.${k}`)} htmlFor={`set-social-${k}`}>
            <Input id={`set-social-${k}`} dir="ltr" value={settings.socials?.[k] ?? ""} readOnly />
          </Field>
        ))}
      </div>

      <div role="tabpanel" id="set-panel-seo" aria-labelledby="set-tab-seo" hidden={section !== "seo"}>
        <LangTabs id="seo" lang={lang} setLang={setLang} errs={langErr(SEO_FIELDS)} />
        {localized("seo", [
          { base: "seoTitle", label: "seoTitle" },
          { base: "seoDesc", label: "seoDesc", textarea: true },
        ])}
      </div>

      {formError && (
        <p role="alert" className="mt-3 text-sm text-destructive" data-testid="settings-form-error">
          {formError}
        </p>
      )}
      <div className="sticky bottom-0 mt-6 flex items-center justify-end gap-3 border-t border-border bg-card py-3">
        {saved && (
          <p role="status" className="text-sm text-success" data-testid="settings-saved">
            {t("settings.form.saved")}
          </p>
        )}
        <Button type="submit" disabled={save.isPending} data-testid="settings-save">
          {t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const q = useSettings();
  const [epoch, setEpoch] = useState(0);
  return (
    <section aria-labelledby="set-title">
      <h1 id="set-title" className="font-display text-2xl font-semibold">
        {t("settings.title")}
      </h1>
      {q.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("settings.loading")}
        </p>
      )}
      {q.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="settings-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, q.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
            {t("settings.retry")}
          </Button>
        </div>
      )}
      {q.isSuccess && (
        <SettingsForm
          key={epoch}
          settings={q.data}
          onReload={async () => {
            await q.refetch();
            setEpoch((e) => e + 1);
          }}
        />
      )}
    </section>
  );
}
