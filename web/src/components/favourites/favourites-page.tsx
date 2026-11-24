"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { ConnectedProductCard } from "@/components/favourites/connected-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { errorMessageKey } from "@/lib/api/errors";
import type { HomeProduct } from "@/lib/api/public";
import { useAuthStore } from "@/lib/auth/store";
import {
  loadFavourites,
  resolveGuestFavourites,
  syncFavouritesAfterLogin,
  useFavouritesStore,
} from "@/lib/favourites/store";

/** W-08 Favourites: card grid (remove with the heart), empty state, merge-failed notice with retry. */
export function FavouritesPage() {
  const t = useTranslations("favourites");
  const te = useTranslations("errors");
  const locale = useLocale() as Locale;
  const status = useAuthStore((s) => s.status);
  const server = useAuthStore((s) => s.status === "authenticated" && s.user?.role === "CUSTOMER");
  const { items, ids, guest, loaded, loading, error, mergeFailed } = useFavouritesStore();
  const [guestItems, setGuestItems] = useState<HomeProduct[] | null>(null);
  const guestKey = guest.map((g) => g.productId).join(",");

  useEffect(() => {
    if (server && !loaded) void loadFavourites();
  }, [server, loaded]);

  useEffect(() => {
    if (status === "unknown" || server) return;
    let alive = true;
    void resolveGuestFavourites().then((p) => alive && setGuestItems(p));
    return () => {
      alive = false;
    };
  }, [status, server, guestKey]);

  const list = server
    ? items.filter((p) => ids.includes(p.id))
    : (guestItems ?? []).filter((p) => guest.some((g) => g.productId === p.id));
  const busy = server ? loading && !loaded : guestItems === null && guest.length > 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10" data-testid="favourites-page">
      <h1 className="font-display text-3xl font-semibold">{t("title")}</h1>
      {mergeFailed ? (
        <p role="alert" data-testid="merge-failed" className="mt-4 rounded-md border border-destructive/40 bg-card p-3 text-sm text-destructive">
          {t("mergeFailed")}{" "}
          <button type="button" className="font-medium underline" onClick={() => void syncFavouritesAfterLogin()}>
            {t("retry")}
          </button>
        </p>
      ) : error ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {te(errorMessageKey(error))}
        </p>
      ) : null}
      {busy ? (
        <p className="mt-8 text-muted-foreground" role="status">{t("loading")}</p>
      ) : list.length === 0 ? (
        <div className="mt-10 rounded-lg border border-border bg-muted p-10 text-center" data-testid="favourites-empty">
          <p className="font-display text-xl">{t("emptyTitle")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyText")}</p>
          <Button asChild className="mt-6">
            <Link href="/shop">{t("browse")}</Link>
          </Button>
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="favourites-grid">
          {list.map((p) => (
            <ConnectedProductCard key={p.id} product={p} locale={locale} />
          ))}
        </ul>
      )}
    </main>
  );
}
