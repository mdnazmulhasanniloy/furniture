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

/** Bell (logged in only) + account entry (W-01). Links to T-037/T-039/T-040 routes. */
export function AccountActions() {
  const t = useTranslations("nav");
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();

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
      <Button asChild variant="ghost" size="icon" data-testid="notifications-bell">
        <Link href="/account/notifications" aria-label={t("notifications")}>
          <Bell aria-hidden />
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
