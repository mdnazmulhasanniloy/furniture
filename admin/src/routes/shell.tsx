import {
  Bell,
  FileText,
  Image,
  LayoutDashboard,
  LayoutList,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShoppingBag,
  Tags,
  Users,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ADMIN_ROLE, logout } from "@/lib/auth/flows";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";
import { PreferenceToggles, PublicFrame } from "./public-frame";

export const SIDEBAR_KEY = "fx_admin_sidebar";

export const NAV: { path: string; key: string; icon: LucideIcon }[] = [
  { path: "/", key: "overview", icon: LayoutDashboard },
  { path: "/products", key: "products", icon: Package },
  { path: "/categories", key: "categories", icon: Tags },
  { path: "/orders", key: "orders", icon: ShoppingBag },
  { path: "/customers", key: "customers", icon: Users },
  { path: "/banners", key: "banners", icon: Image },
  { path: "/sections", key: "sections", icon: LayoutList },
  { path: "/pages", key: "pages", icon: FileText },
  { path: "/settings", key: "settings", icon: Settings },
  { path: "/admins", key: "admins", icon: UserCog },
];

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Route guard (AUTH-06): UX only. No session -> redirect to /login. The API enforces the
 * role on every /admin/* call (403 for CUSTOMER); this never replaces that.
 */
export function RequireAdmin() {
  const { status, user } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();
  if (status === "unknown") {
    return (
      <PublicFrame>
        <p role="status" className="text-center text-muted-foreground">
          {t("auth.restoring")}
        </p>
      </PublicFrame>
    );
  }
  if (status !== "authenticated" || user?.role !== ADMIN_ROLE) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <Shell />;
}

function AvatarMenu() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);
  if (!user) return null;
  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("shell.accountMenu")}
        data-testid="avatar-button"
        onClick={() => setOpen((o) => !o)}
      >
        {initials}
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 z-20 mt-2 w-56 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md"
        >
          <p className="px-2 py-1 text-sm font-medium">
            {user.firstName} {user.lastName}
          </p>
          <p className="px-2 pb-2 text-xs text-muted-foreground" dir="ltr">
            {user.email}
          </p>
          <Button
            role="menuitem"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            data-testid="logout"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            {t("shell.logout")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function Shell() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside
        data-testid="sidebar"
        data-collapsed={collapsed}
        className={cn(
          "flex shrink-0 flex-col border-e border-border bg-card transition-[width]",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 border-b border-border px-3">
          {!collapsed && <span className="font-display text-lg font-semibold">{t("app.title")}</span>}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t(collapsed ? "shell.expandSidebar" : "shell.collapseSidebar")}
            aria-expanded={!collapsed}
            data-testid="sidebar-toggle"
            onClick={toggle}
          >
            {/* The icons point towards the inline-start edge; flipped in RTL so they mirror. */}
            {collapsed ? <PanelLeftOpen className="rtl:-scale-x-100" /> : <PanelLeftClose className="rtl:-scale-x-100" />}
          </Button>
        </div>
        <nav aria-label={t("shell.mainNav")} className="flex flex-col gap-1 p-2">
          {NAV.map(({ path, key, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === "/"}
              title={t(`nav.${key}`)}
              className={({ isActive }) =>
                cn(
                  "flex h-10 items-center gap-3 rounded-md px-3 text-sm hover:bg-muted",
                  isActive && "bg-muted font-medium text-primary",
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className={cn(collapsed && "sr-only")}>{t(`nav.${key}`)}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <Input
            type="search"
            className="max-w-xs"
            placeholder={t("common.search")}
            aria-label={t("common.search")}
            data-testid="topbar-search"
          />
          <div className="ms-auto flex items-center gap-2">
            <PreferenceToggles />
            {/* Live bell arrives with T-071 (ADM-10). */}
            <Button variant="ghost" size="icon" aria-label={t("shell.notifications")} data-testid="bell">
              <Bell className="size-4" aria-hidden />
            </Button>
            <AvatarMenu />
          </div>
        </header>
        <main className="p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
