"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { AddressForm, type CityOption } from "@/components/checkout/address-form";
import { PhoneText } from "@/components/format";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import { deleteAddress, updateAddress } from "@/lib/account/api";
import { apiErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/store";
import { listAddresses, type Address } from "@/lib/checkout/api";
import { pick } from "@/lib/pick";

/** PROF-02: add / edit / delete addresses, one default. "Not deliverable" comes from `isDeliverable` only. */
export function AddressesPanel({ cities }: { cities: CityOption[] }) {
  const t = useTranslations("account.addresses");
  const tc = useTranslations("checkout");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const user = useAuthStore((s) => s.user);
  const [list, setList] = useState<Address[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const load = () => setReload((n) => n + 1);
  useEffect(() => {
    if (!user) return;
    let live = true;
    listAddresses()
      .then((l) => {
        if (!live) return;
        setList(l);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [user, reload]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setActionError(null);
    try {
      await fn();
      setConfirmId(null);
      load();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusyId(null);
    }
  }

  if (failed && !list) {
    return (
      <div role="alert" className="space-y-3 text-sm text-destructive">
        <p>{t("loadError")}</p>
        <Button variant="outline" onClick={() => load()}>{tc("retry")}</Button>
      </div>
    );
  }
  if (!list) return <p role="status" className="text-sm text-muted-foreground">{tc("loading")}</p>;

  const saved = () => {
    setEditing(null);
    load();
  };

  return (
    <section aria-labelledby="addr-h" className="space-y-4" data-testid="addresses-panel">
      <div className="flex items-center justify-between gap-3">
        <h2 id="addr-h" className="font-display text-lg font-semibold">{t("title")}</h2>
        {editing !== "new" ? (
          <Button onClick={() => { setEditing("new"); setActionError(null); }} data-testid="add-address">
            {tc("addAddress")}
          </Button>
        ) : null}
      </div>
      {actionError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">
          {apiErrorMessage(te as unknown as Parameters<typeof apiErrorMessage>[0], actionError)}
        </p>
      ) : null}
      {editing === "new" ? (
        <AddressForm cities={cities} showDefault onCreated={saved} onCancel={() => setEditing(null)} />
      ) : null}
      {list.length === 0 && editing !== "new" ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      <ul className="space-y-3" data-testid="address-book">
        {list.map((a) => {
          const city = cities.find((c) => c.code === a.cityCode);
          return (
            <li key={a.id} className="rounded-lg border border-border bg-card p-4" data-testid="address-item">
              {editing === a.id ? (
                <AddressForm cities={cities} address={a} showDefault onCreated={saved} onCancel={() => setEditing(null)} />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.label}</span>
                    {a.isDefault ? (
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{tc("defaultBadge")}</span>
                    ) : null}
                    {!a.isDeliverable ? (
                      <span className="rounded-full border border-destructive px-2 py-0.5 text-xs text-destructive" data-testid="not-deliverable">
                        {tc("notDeliverableBadge")}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm">{a.fullName} · <PhoneText value={a.phone} /></p>
                  <p className="text-sm text-muted-foreground">
                    {[city ? pick(city.name, locale) : a.cityCode, a.area, a.street].join(", ")}
                  </p>
                  {a.notes ? <p className="text-sm text-muted-foreground">{a.notes}</p> : null}
                  {!a.isDeliverable ? <p className="mt-1 text-xs text-muted-foreground">{tc("notDeliverableHint")}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(a.id); setActionError(null); }}>
                      {t("edit")}
                    </Button>
                    {!a.isDefault ? (
                      <Button size="sm" variant="outline" disabled={busyId === a.id} onClick={() => void run(a.id, () => updateAddress(a.id, { isDefault: true }))}>
                        {t("makeDefault")}
                      </Button>
                    ) : null}
                    {confirmId === a.id ? (
                      <>
                        <Button size="sm" variant="destructive" disabled={busyId === a.id} onClick={() => void run(a.id, () => deleteAddress(a.id))}>
                          {t("confirmDelete")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>{tc("form.cancel")}</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(a.id)}>{t("delete")}</Button>
                    )}
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
