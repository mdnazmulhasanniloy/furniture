"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Link, useRouter } from "@/i18n/navigation";
import { useAuthStore } from "@/lib/auth/store";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "profile", href: "/account" },
  { key: "addresses", href: "/account/addresses" },
  { key: "orders", href: "/account/orders" },
  { key: "notifications", href: "/account/notifications" },
] as const;

/** W-07 shell: tabs + auth guard. Guests go to /login; admins see a notice (customer-only area). */
export function AccountShell({
  tab,
  children,
}: {
  tab: (typeof TABS)[number]["key"];
  children: React.ReactNode;
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  const ready = status === "authenticated" && user?.role === "CUSTOMER";
  return (
    <main className="band mx-auto w-full max-w-5xl px-5 sm:px-8 lg:px-12" data-testid="account-page">
      <h1 className="text-4xl md:text-5xl">{t("title")}</h1>
      <nav aria-label={t("title")} className="rail-scroll mt-4 flex gap-1 border-b border-border">
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={x.href}
            aria-current={x.key === tab ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-4 py-2.5 text-base font-medium",
              x.key === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`tabs.${x.key}`)}
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        {ready ? (
          children
        ) : status === "authenticated" ? (
          <p className="text-sm text-muted-foreground">{t("adminNotice")}</p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
      </div>
    </main>
  );
}
