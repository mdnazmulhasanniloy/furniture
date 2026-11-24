import type { FieldErrors, UseFormRegister, UseFormSetValue, UseFormWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Field } from "@/components/modal";
import { Input } from "@/components/ui/input";
import { formatPrice, toLocale } from "@/lib/format";
import type { SettingsFormValues } from "@/lib/settings";
import { exampleVat, parseRate } from "@/lib/vat";
import { cn } from "@/lib/utils";

function Toggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="mt-4 flex items-start justify-between gap-3">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border px-0.5 transition-colors disabled:opacity-50",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span className={cn("size-4 rounded-full bg-card transition-transform", checked && "translate-x-5 rtl:-translate-x-5")} />
      </button>
    </div>
  );
}

export function VatPanel({
  register,
  errs,
  watch,
  setValue,
}: {
  register: UseFormRegister<SettingsFormValues>;
  errs: FieldErrors<SettingsFormValues>;
  watch: UseFormWatch<SettingsFormValues>;
  setValue: UseFormSetValue<SettingsFormValues>;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const rate = parseRate(watch("vatRate") ?? "");
  const bp = rate.ok ? rate.bp : null;
  const inclusive = watch("vatInclusive");
  const applyDelivery = watch("vatApplyDelivery");
  const noVat = bp === null || bp === 0;
  const msg = (m?: string) => (m ? t(m) : undefined);
  const set = (k: "vatApplyDelivery" | "vatInclusive") => (v: boolean) => setValue(k, v, { shouldDirty: true });
  return (
    <>
      <p className="mt-3 text-sm text-muted-foreground">{t("settings.vat.intro")}</p>
      <Field label={t("settings.vat.rate")} htmlFor="set-vat-rate" hint={t("settings.vat.rateHint")} error={msg(errs.vatRate?.message)}>
        <Input id="set-vat-rate" dir="ltr" inputMode="decimal" aria-invalid={!!errs.vatRate} {...register("vatRate")} />
      </Field>
      <Toggle
        id="set-vat-delivery"
        label={t("settings.vat.applyDelivery")}
        hint={noVat ? t("settings.vat.applyDeliveryDisabled") : t("settings.vat.applyDeliveryHint")}
        checked={applyDelivery}
        disabled={noVat}
        onChange={set("vatApplyDelivery")}
      />
      <Toggle
        id="set-vat-inclusive"
        label={t("settings.vat.pricesInclude")}
        hint={t("settings.vat.pricesIncludeHint")}
        checked={inclusive}
        onChange={set("vatInclusive")}
      />
      <Field
        label={t("settings.vat.number")}
        htmlFor="set-vat-number"
        hint={t("settings.vat.numberHint")}
        error={msg(errs.vatNumber?.message)}
      >
        <Input id="set-vat-number" dir="ltr" inputMode="numeric" aria-invalid={!!errs.vatNumber} {...register("vatNumber")} />
      </Field>
      <div className="mt-4 rounded-md border border-border bg-card p-3 text-sm" data-testid="vat-example">
        {noVat ? (
          <p>{t("settings.vat.exampleNone")}</p>
        ) : (
          <p>
            {t(inclusive ? "settings.vat.exampleIncl" : "settings.vat.exampleExcl", {
              price: formatPrice(10000, locale),
              vat: formatPrice(exampleVat(bp, inclusive), locale),
            })}
          </p>
        )}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{t("settings.vat.existingOrders")}</p>
    </>
  );
}
