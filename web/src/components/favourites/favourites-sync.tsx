"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { useAuthStore } from "@/lib/auth/store";
import { GUEST_FAV_KEY } from "@/lib/favourites/guest";
import {
  hydrateGuestFavourites,
  dismissFull,
  useFavouritesStore,
  resetFavouritesToGuest,
  syncFavouritesAfterLogin,
} from "@/lib/favourites/store";

/** Mounted once in Providers: loads the guest list, merges it on login, resets on logout. */
export function FavouritesSync() {
  const t = useTranslations("favourites");
  const full = useFavouritesStore((s) => s.full);
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    hydrateGuestFavourites();
    const onStorage = (e: StorageEvent) => {
      if (e.key === GUEST_FAV_KEY || e.key === null) hydrateGuestFavourites();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && role === "CUSTOMER") void syncFavouritesAfterLogin();
    else if (status === "anonymous") resetFavouritesToGuest();
  }, [status, role]);

  useEffect(() => {
    if (!full) return;
    const id = setTimeout(dismissFull, 5000);
    return () => clearTimeout(id);
  }, [full]);

  // The list holds 100 products and an add was refused (FAV-01): a localized message.
  return full ? (
    <p
      role="status"
      data-testid="favourites-full"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-sm rounded-md border border-border bg-card p-3 text-sm text-warning-foreground shadow-float"
    >
      {t("full")}
    </p>
  ) : null;
}
