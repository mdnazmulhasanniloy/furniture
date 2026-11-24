"use client";

import { Heart } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { favouriteIds, isServerFavourites, useFavouritesStore } from "@/lib/favourites/store";

/** Header heart with the favourites count (FAV-01, W-08). */
export function FavouritesLink() {
  const t = useTranslations("favourites");
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const server = status === "authenticated" && role === "CUSTOMER" && isServerFavourites();
  const count = useFavouritesStore((s) => favouriteIds(s, server).length);
  return (
    <Button asChild variant="ghost" size="icon" data-testid="favourites-link" className="relative">
      <Link href="/favourites" aria-label={count > 0 ? t("linkLabel", { count }) : t("title")}>
        <Heart aria-hidden />
        {count > 0 ? (
          <span
            data-testid="favourites-count"
            aria-hidden
            className="absolute -end-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground"
          >
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}
