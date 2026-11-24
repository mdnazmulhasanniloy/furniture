"use client";

import { Bell, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, useRouter } from "@/i18n/navigation";
import { logout } from "@/lib/auth/session";
import { useAuthStore } from "@/lib/auth/store";
import { useNotificationStore } from "@/lib/notifications/store";

/** Bell (logged in only) + account entry (W-01). Links to T-037/T-039/T-040 routes. */
export function AccountActions() {
  const t = useTranslations("nav");
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const unread = useNotificationStore((s) => s.unread);

  if (status !== "authenticated" || !user) {
    return (
      <Button asChild variant="ghost" size="icon" data-testid="account-login">
        <Link href="/login" aria-label={t("login")}>
          <User aria-hidden />
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild variant="ghost" size="icon" data-testid="notifications-bell" className="relative">
        <Link
          href="/account/notifications"
          aria-label={unread > 0 ? t("notificationsBadge", { count: unread }) : t("notifications")}
        >
          <Bell aria-hidden />
          {unread > 0 ? (
            <span
              data-testid="notifications-count"
              aria-hidden
              className="absolute -end-1 -top-1 min-w-4 rounded-full bg-gold px-1 text-center text-[10px] font-semibold leading-4 text-gold-foreground"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Link>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("account")} data-testid="account-menu">
            <User aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => router.push("/account")}>
            {t("account")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              void logout().then(() => router.push("/"));
            }}
          >
            {t("logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
