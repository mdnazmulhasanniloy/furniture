import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { Field, Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api/errors";
import { errorMessage } from "@/lib/api/messages";
import {
  customerState,
  isSaudiMobile,
  useBlockCustomer,
  useCustomer,
  useDeleteCustomer,
  useUpdateCustomer,
  type Customer,
} from "@/lib/customers";
import { formatDateTime, formatNumber, formatPrice, toLocale } from "@/lib/format";
import { STATUS_CLASS } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { StateBadge } from "@/routes/customers-page";

type Locale = ReturnType<typeof toLocale>;

/** Block (reason required, 3 to 300 characters, admin-only) and unblock. The caller never shows these to the customer. */
function BlockControl({ user }: { user: Customer }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const block = useBlockCustomer(user.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim();
  const valid = trimmed.length >= 3 && trimmed.length <= 300;
  const close = () => {
    setOpen(false);
    setReason("");
    setError(null);
  };
  const fail = (e: unknown) => {
    setError(errorMessage(t, locale, e));
    if (e instanceof ApiError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN_TARGET" || e.code === "CUSTOMER_DELETED")) setOpen(false);
  };
  return (
    <div>
      {user.isBlocked ? (
        <Button
          variant="outline"
          disabled={block.isPending}
          data-testid="customer-unblock"
          onClick={async () => {
            setError(null);
            try {
              await block.mutateAsync({ isBlocked: false });
            } catch (e) {
              fail(e);
            }
          }}
        >
          {t("customers.unblock.confirm")}
        </Button>
      ) : (
        <Button
          variant="destructive"
          data-testid="customer-block"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          {t("customers.block.confirm")}
        </Button>
      )}
      {error && !open && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="customer-block-error">
          {error}
        </p>
      )}
      {open && (
        <Modal title={t("customers.block.title")} onClose={close} testId="customer-block-dialog">
          <p className="mt-3 text-sm">{t("customers.blockDialog.body")}</p>
          <Field label={t("customers.block.reason")} htmlFor="cust-block-reason">
            <textarea
              id="cust-block-reason"
              data-testid="customer-block-reason"
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            />
          </Field>
          {error && (
            <p role="alert" className="mt-2 text-sm text-destructive" data-testid="customer-block-error">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              {t("customers.blockDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={block.isPending || !valid}
              data-testid="customer-block-confirm"
              onClick={async () => {
                setError(null);
                try {
                  await block.mutateAsync({ isBlocked: true, reason: trimmed });
                  close();
                } catch (e) {
                  fail(e);
                }
              }}
            >
              {t("customers.block.confirm")}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Name and phone only (the API refuses every other field). The email is shown but never editable here. */
function EditDialog({ user, onClose }: { user: Customer; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const update = useUpdateCustomer(user.id);
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <Modal title={t("customers.edit.title")} onClose={onClose} testId="customer-edit-dialog">
      <p className="mt-3 text-sm text-muted-foreground">{t("customers.edit.note")}</p>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          const f = first.trim();
          const l = last.trim();
          const p = phone.trim();
          const bad = !f || f.length > 40 || !l || l.length > 40 || (p !== "" && !isSaudiMobile(p));
          setInvalid(bad);
          if (bad) return;
          const body: Parameters<typeof update.mutateAsync>[0] = { expectedUpdatedAt: user.updatedAt as string };
          if (f !== user.firstName) body.firstName = f;
          if (l !== user.lastName) body.lastName = l;
          if (p !== (user.phone ?? "")) body.phone = p === "" ? null : p;
          if (Object.keys(body).length === 1) {
            onClose(); // nothing changed
            return;
          }
          try {
            await update.mutateAsync(body);
            onClose();
          } catch (err) {
            setError(errorMessage(t, locale, err));
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("customers.firstName")} htmlFor="cust-first">
            <Input id="cust-first" value={first} maxLength={40} onChange={(e) => setFirst(e.target.value)} aria-invalid={invalid && !first.trim()} />
          </Field>
          <Field label={t("customers.lastName")} htmlFor="cust-last">
            <Input id="cust-last" value={last} maxLength={40} onChange={(e) => setLast(e.target.value)} aria-invalid={invalid && !last.trim()} />
          </Field>
        </div>
        <Field label={t("customers.phone")} htmlFor="cust-phone">
          <Input id="cust-phone" type="tel" dir="ltr" placeholder="+966 5X XXX XXXX" value={phone} maxLength={25} onChange={(e) => setPhone(e.target.value)} aria-invalid={invalid && phone.trim() !== "" && !isSaudiMobile(phone)} />
        </Field>
        {(invalid || error) && (
          <p role="alert" className="mt-3 text-sm text-destructive" data-testid="customer-edit-error">
            {error ?? t("errors.VALIDATION_ERROR")}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={update.isPending} data-testid="customer-edit-save">
            {t("common.save")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Soft delete: the admin types the customer's email (the server checks it again). Orders are kept. */
function DeleteDialog({ user, onClose }: { user: Customer; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const locale: Locale = toLocale(i18n.language);
  const del = useDeleteCustomer(user.id);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim().toLowerCase() === user.email.toLowerCase();
  return (
    <Modal title={t("customers.delete.title")} onClose={onClose} testId="customer-delete-dialog">
      <p className="mt-3 text-sm">{t("customers.delete.body")}</p>
      <Field label={t("customers.delete.typeEmail", { email: user.email })} htmlFor="cust-delete-email">
        <Input id="cust-delete-email" data-testid="customer-delete-email" dir="ltr" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </Field>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive" data-testid="customer-delete-error">
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="destructive"
          disabled={del.isPending || !matches}
          data-testid="customer-delete-confirm"
          onClick={async () => {
            setError(null);
            try {
              await del.mutateAsync(typed.trim());
              onClose();
            } catch (e) {
              setError(errorMessage(t, locale, e));
            }
          }}
        >
          {t("customers.delete.confirm")}
        </Button>
      </div>
    </Modal>
  );
}

export function CustomerDetailPage() {
  const { t, i18n } = useTranslation();
  const locale = toLocale(i18n.language);
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const q = useCustomer(id, page);

  if (q.isPending)
    return (
      <p role="status" className="text-muted-foreground">
        {t("customers.loading")}
      </p>
    );
  if (q.isError)
    return (
      <div className="flex items-center gap-3" data-testid="customer-error">
        <p role="alert" className="text-destructive">
          {errorMessage(t, locale, q.error)}
        </p>
        <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
          {t("customers.retry")}
        </Button>
      </div>
    );
  const { user, orders, meta } = q.data;
  const state = customerState(user);
  const deleted = state === "deleted";
  const info: [string, React.ReactNode][] = [
    [t("customers.col.email"), <bdi key="e" dir="ltr">{user.email}</bdi>],
    [t("customers.phone"), user.phone ? <bdi key="p" dir="ltr">{user.phone}</bdi> : "—"],
    [t("customers.verified"), user.isVerified ? t("customers.yes") : t("customers.no")],
    [t("customers.locale"), user.preferredLocale === "en" ? "English" : "العربية"],
    [t("customers.col.joined"), user.createdAt ? formatDateTime(user.createdAt, locale) : "—"],
  ];
  if (state === "blocked" && user.blockedReason) {
    info.push([t("customers.blockedReasonLabel"), <span key="r" data-testid="customer-blocked-reason">{user.blockedReason}{user.blockedAt ? <span className="block text-xs text-muted-foreground">{formatDateTime(user.blockedAt, locale)}</span> : null}</span>]);
  }
  if (deleted && user.deletedAt) info.push([t("customers.status.deleted"), formatDateTime(user.deletedAt, locale)]);
  return (
    <section aria-labelledby="customer-title">
      <Link to="/customers" className="text-sm text-primary hover:underline">
        {t("customers.back")}
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="customer-title" className="font-display text-2xl font-semibold">
            {deleted ? t("customers.deletedName") : `${user.firstName} ${user.lastName}`}
          </h1>
          <div className="mt-1">
            <StateBadge state={state} />
          </div>
        </div>
        {!deleted && (
          <div className="flex flex-wrap gap-2" data-testid="customer-actions">
            <Button variant="outline" data-testid="customer-edit" onClick={() => setDialog("edit")}>
              {t("customers.edit.title")}
            </Button>
            <BlockControl user={user} />
            <Button variant="destructive" data-testid="customer-delete" onClick={() => setDialog("delete")}>
              {t("customers.delete.title")}
            </Button>
          </div>
        )}
      </div>
      <dl className="mt-4 grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2" data-testid="customer-info">
        {info.map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted-foreground">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h2 className="mt-6 font-display text-lg font-semibold">{t("customers.ordersTitle")}</h2>
      {orders.length === 0 ? (
        <p className="mt-2 text-muted-foreground" data-testid="customer-orders-empty">
          {t("customers.noOrders")}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm" data-testid="customer-orders">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {(["order", "status", "total", "placed"] as const).map((k) => (
                  <th key={k} scope="col" className="px-3 py-2 text-start font-medium">
                    {t(`orders.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t border-border" data-testid="customer-order-row">
                  <td className="px-3 py-2 text-start font-medium">
                    <Link to={`/orders/${encodeURIComponent(o.id)}`} className="text-primary hover:underline" data-testid="customer-order-link">
                      <bdi dir="ltr">{o.orderNo}</bdi>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-medium", STATUS_CLASS[o.status])}>
                      {t(`orders.status.${o.status}`)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-start">
                    <bdi>{formatPrice(o.total, locale)}</bdi>
                  </td>
                  <td className="px-3 py-2 text-start text-muted-foreground">{formatDateTime(o.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta.totalPages > 1 && (
        <nav className="mt-3 flex items-center justify-end gap-2 text-sm" aria-label={t("customers.ordersTitle")}>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t("customers.prev")}
          </Button>
          <span data-testid="customer-orders-page">
            {t("customers.pageOf", { page: formatNumber(meta.page, locale), total: formatNumber(meta.totalPages, locale) })}
          </span>
          <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>
            {t("customers.next")}
          </Button>
        </nav>
      )}
      {dialog === "edit" && !deleted && <EditDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === "delete" && !deleted && <DeleteDialog user={user} onClose={() => setDialog(null)} />}
    </section>
  );
}
