import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Field, Modal } from "@/components/modal";
import { PasswordRules } from "@/components/password-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  changePasswordSchema,
  profileSchema,
  useChangePassword,
  useUpdateProfile,
  type ChangePasswordValues,
  type ProfileValues,
} from "@/lib/account";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import { useAuth } from "@/lib/auth/use-auth";
import { toLocale } from "@/lib/format";

// T-109 (QA C5). Two dialogs in the account menu. Copy approved by the owner 2026-11-25; every
// message here is a locale key, never API text (rule 8).

/**
 * Change password. The current password is required and a wrong one counts toward the sign-in lockout
 * (T-108), so the client refuses what it can first: empty fields, a new password that breaks the
 * shared policy, a mismatched confirmation, and a new password equal to the current one.
 */
export function ChangePasswordDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const change = useChangePassword();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: keyof ChangePasswordValues; key: string } | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const newPassword = watch("newPassword");
  /** A field's own message wins over the schema's, so an API answer lands where it belongs. */
  const msg = (field: keyof ChangePasswordValues) => {
    if (fieldError?.field === field) return t(fieldError.key);
    const m = errors[field]?.message;
    return m ? t(m) : undefined;
  };

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    setFieldError(null);
    try {
      await change.mutateAsync(v);
      onDone(t("account.passwordSaved"));
    } catch (e) {
      // The current password is wrong: say so on that field. The shared INVALID_CREDENTIALS message
      // talks about an email and a password, and no email is involved here.
      if (e instanceof ApiError && e.code === "INVALID_CREDENTIALS") {
        setFieldError({ field: "currentPassword", key: "account.currentWrong" });
        return;
      }
      if (e instanceof ApiError && e.code === "SAME_PASSWORD") {
        setFieldError({ field: "newPassword", key: "account.sameAsCurrent" });
        return;
      }
      // PASSWORD_TOO_WEAK, ACCOUNT_LOCKED (with its retry wait) and anything else: localized by code.
      setFormError(errorMessage(t, locale, e));
    }
  });

  return (
    <Modal title={t("account.changePassword")} onClose={onClose} testId="account-password-dialog">
      <form onSubmit={submit} noValidate>
        <Field label={t("account.current")} htmlFor="acc-current" error={msg("currentPassword")}>
          <Input
            id="acc-current"
            type="password"
            autoComplete="current-password"
            dir="ltr"
            aria-invalid={!!msg("currentPassword")}
            {...register("currentPassword")}
          />
        </Field>
        <Field label={t("auth.newPassword")} htmlFor="acc-new" error={msg("newPassword")}>
          <Input
            id="acc-new"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            aria-describedby="acc-rules"
            aria-invalid={!!msg("newPassword")}
            {...register("newPassword")}
          />
        </Field>
        <div className="mt-2">
          <PasswordRules value={newPassword} id="acc-rules" />
        </div>
        <Field label={t("account.confirm")} htmlFor="acc-confirm" error={msg("confirmPassword")}>
          <Input
            id="acc-confirm"
            type="password"
            autoComplete="new-password"
            dir="ltr"
            aria-invalid={!!msg("confirmPassword")}
            {...register("confirmPassword")}
          />
        </Field>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="account-password-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting} data-testid="account-password-submit">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Profile: the name only. `PATCH /me` takes it; the email has no endpoint anywhere, by design. */
export function ProfileDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { user } = useAuth();
  const save = useUpdateProfile();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { firstName: user?.firstName ?? "", lastName: user?.lastName ?? "" },
  });
  const msg = (m?: string) => (m ? t(`admins.form.errors.${m}`) : undefined);

  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await save.mutateAsync(v);
      onDone(t("account.profileSaved"));
    } catch (e) {
      setFormError(errorMessage(t, locale, e));
    }
  });

  return (
    <Modal title={t("account.profile")} onClose={onClose} testId="account-profile-dialog">
      <form onSubmit={submit} noValidate>
        <Field label={t("admins.form.firstName")} htmlFor="acc-first" error={msg(errors.firstName?.message)}>
          <Input id="acc-first" maxLength={40} aria-invalid={!!errors.firstName} {...register("firstName")} />
        </Field>
        <Field label={t("admins.form.lastName")} htmlFor="acc-last" error={msg(errors.lastName?.message)}>
          <Input id="acc-last" maxLength={40} aria-invalid={!!errors.lastName} {...register("lastName")} />
        </Field>
        <Field label={t("admins.form.email")} htmlFor="acc-email" hint={t("account.emailFixed")}>
          <Input id="acc-email" type="email" dir="ltr" readOnly value={user?.email ?? ""} data-testid="account-email" />
        </Field>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="account-profile-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={isSubmitting} data-testid="account-profile-submit">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
