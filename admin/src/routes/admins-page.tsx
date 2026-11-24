import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api/messages";
import { useAdmins, useBlockAdmin, useInviteAdmin, useResendInvite, type AdminUser } from "@/lib/admins";
import { formatDateTime, toLocale } from "@/lib/format";
import { cn } from "@/lib/utils";

// api-spec POST /admin/admins: names 1-40 chars, valid email, locale en|ar (default ar); no password.
const schema = z.object({
  firstName: z.string().trim().min(1, "required").max(40, "tooLong"),
  lastName: z.string().trim().min(1, "required").max(40, "tooLong"),
  email: z.string().trim().email("invalidEmail"),
  preferredLocale: z.enum(["ar", "en"]),
});
type Values = z.infer<typeof schema>;

function InviteDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const invite = useInviteAdmin();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: "", lastName: "", email: "", preferredLocale: "ar" },
  });
  const errs = formState.errors;
  const msg = (m?: string) => (m ? t(`admins.form.errors.${m}`) : undefined);
  const submit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      await invite.mutateAsync(v);
      onDone();
    } catch (e) {
      setFormError(errorMessage(t, locale, e));
    }
  });
  return (
    <Modal title={t("admins.invite.title")} onClose={onClose} testId="admin-invite-dialog">
      <form onSubmit={submit} noValidate>
        <p className="mt-2 text-sm text-muted-foreground">{t("admins.invite.hint")}</p>
        <Field label={t("admins.form.firstName")} htmlFor="adm-first" error={msg(errs.firstName?.message)}>
          <Input id="adm-first" maxLength={40} aria-invalid={!!errs.firstName} {...register("firstName")} />
        </Field>
        <Field label={t("admins.form.lastName")} htmlFor="adm-last" error={msg(errs.lastName?.message)}>
          <Input id="adm-last" maxLength={40} aria-invalid={!!errs.lastName} {...register("lastName")} />
        </Field>
        <Field label={t("admins.form.email")} htmlFor="adm-email" error={msg(errs.email?.message)}>
          <Input id="adm-email" type="email" dir="ltr" aria-invalid={!!errs.email} {...register("email")} />
        </Field>
        <Field label={t("admins.form.locale")} htmlFor="adm-locale" hint={t("admins.form.localeHint")}>
          <select
            id="adm-locale"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-card-foreground"
            {...register("preferredLocale")}
          >
            <option value="ar">{t("admins.form.localeAr")}</option>
            <option value="en">{t("admins.form.localeEn")}</option>
          </select>
        </Field>
        {formError && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="admin-invite-error">
            {formError}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("admins.invite.cancel")}
          </Button>
          <Button type="submit" disabled={invite.isPending} data-testid="admin-invite-submit">
            {t("admins.invite.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function StatusBadge({ admin }: { admin: AdminUser }) {
  const { t } = useTranslation();
  const [key, cls] = admin.isBlocked
    ? (["blocked", "bg-destructive/15 text-destructive"] as const)
    : !admin.isVerified
      ? (["pending", "bg-warning/15 text-warning-foreground"] as const)
      : (["active", "bg-success/15 text-success-foreground"] as const);
  return (
    <span data-testid="admin-state" className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", cls)}>
      {t(`admins.state.${key}`)}
    </span>
  );
}

export function AdminsPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const list = useAdmins();
  const block = useBlockAdmin();
  const resend = useResendInvite();
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const items = list.data ?? [];
  const nameOf = (id: string | null | undefined) => {
    const a = id ? items.find((x) => x.id === id) : undefined;
    return a ? `${a.firstName} ${a.lastName}` : "—";
  };

  const setBlocked = async (a: AdminUser, isBlocked: boolean) => {
    setNotice(null);
    try {
      await block.mutateAsync({ id: a.id, isBlocked });
    } catch (e) {
      // SELF_BLOCK / LAST_ADMIN / NOT_FOUND: localized by code; the hook refetches the list.
      setNotice({ kind: "error", text: errorMessage(t, locale, e) });
    }
    setConfirm(null);
  };
  const resendInvite = async (a: AdminUser) => {
    setNotice(null);
    try {
      await resend.mutateAsync(a.id);
      setNotice({ kind: "ok", text: t("admins.resent", { email: a.email }) });
    } catch (e) {
      // 409 ALREADY_VERIFIED: the hook refetches, so the row now shows the server state.
      setNotice({ kind: "error", text: errorMessage(t, locale, e) });
    }
  };

  return (
    <section aria-labelledby="admins-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="admins-title" className="font-display text-2xl font-semibold">
          {t("admins.title")}
        </h1>
        <Button data-testid="admin-invite-open" onClick={() => setInviting(true)}>
          {t("admins.invite.open")}
        </Button>
      </div>
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          data-testid={`admins-notice-${notice.kind}`}
          className={cn("mt-3 text-sm", notice.kind === "error" ? "text-destructive" : "text-success-foreground")}
        >
          {notice.text}
        </p>
      )}
      {list.isPending && (
        <p role="status" className="mt-4 text-muted-foreground">
          {t("admins.loading")}
        </p>
      )}
      {list.isError && (
        <div className="mt-4 flex items-center gap-3" data-testid="admins-error">
          <p role="alert" className="text-destructive">
            {errorMessage(t, locale, list.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            {t("admins.retry")}
          </Button>
        </div>
      )}
      {list.isSuccess && items.length === 0 && (
        <p className="mt-4 text-muted-foreground" data-testid="admins-empty">
          {t("admins.empty")}
        </p>
      )}
      {items.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="admins-table">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["name", "email", "status", "invitedBy", "created", "actions"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`admins.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-t border-border" data-testid="admin-row">
                  <td className="px-3 py-2 text-start font-medium">
                    {a.firstName} {a.lastName}
                  </td>
                  <td className="px-3 py-2 text-start">
                    <bdi dir="ltr">{a.email}</bdi>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <StatusBadge admin={a} />
                  </td>
                  <td className="px-3 py-2 text-start" data-testid="admin-invited-by">
                    {nameOf(a.invitedById)}
                  </td>
                  <td className="px-3 py-2 text-start text-muted-foreground">
                    {a.createdAt ? formatDateTime(a.createdAt, locale) : "—"}
                  </td>
                  <td className="px-3 py-2 text-start">
                    <div className="flex flex-wrap gap-2">
                      {!a.isVerified && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={resend.isPending}
                          data-testid="admin-resend"
                          onClick={() => void resendInvite(a)}
                        >
                          {t("admins.resend")}
                        </Button>
                      )}
                      {a.isBlocked ? (
                        <Button variant="outline" size="sm" disabled={block.isPending} data-testid="admin-unblock" onClick={() => void setBlocked(a, false)}>
                          {t("admins.unblock")}
                        </Button>
                      ) : (
                        <Button variant="destructive" size="sm" data-testid="admin-block" onClick={() => setConfirm(a)}>
                          {t("admins.block")}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {inviting && (
        <InviteDialog
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false);
            setNotice({ kind: "ok", text: t("admins.invited") });
          }}
        />
      )}
      {confirm && (
        <Modal title={t("admins.blockDialog.title")} onClose={() => setConfirm(null)} testId="admin-block-dialog">
          <p className="mt-3 text-sm">{t("admins.blockDialog.body", { name: `${confirm.firstName} ${confirm.lastName}` })}</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t("admins.blockDialog.cancel")}
            </Button>
            <Button variant="destructive" disabled={block.isPending} data-testid="admin-block-confirm" onClick={() => void setBlocked(confirm, true)}>
              {t("admins.blockDialog.confirm")}
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
