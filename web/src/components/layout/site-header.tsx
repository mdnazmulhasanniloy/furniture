"use client";

import { ChevronDown, Menu, Search, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { useMotionPrefs } from "@/lib/use-motion-prefs";

import { Wordmark } from "@/components/brand";
import { CartButton } from "@/components/cart/cart-button";
import { FavouritesLink } from "@/components/favourites/favourites-link";
import { AccountActions } from "@/components/layout/account-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { Category } from "@/lib/api/public";
import type { CartConfig } from "@/lib/cart/types";
import { pick } from "@/lib/pick";
import { useDialogA11y } from "@/lib/use-dialog-a11y";
import { cn } from "@/lib/utils";

type Props = { categories: Category[]; logoUrl?: string | null; cartConfig?: CartConfig };

const NAV = [
  { key: "shop", href: "/shop" },
  { key: "new", href: "/shop?type=new" },
  { key: "resale", href: "/shop?type=resale" },
] as const;

function categoryHref(slug: string) {
  return `/shop?category=${encodeURIComponent(slug)}`;
}

function SearchForm({ onDone, className, autoFocus }: { onDone?: () => void; className?: string; autoFocus?: boolean }) {
  const t = useTranslations("nav");
  const router = useRouter();
  const [q, setQ] = useState("");
  const inputId = useId();
  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const term = q.trim();
        router.push(term ? `/shop?q=${encodeURIComponent(term)}` : "/shop");
        onDone?.();
      }}
    >
      <label className="sr-only" htmlFor={inputId}>
        {t("searchLabel")}
      </label>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-stone"
        />
        <input
          id={inputId}
          type="search"
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search")}
          className="h-10 w-full rounded-md border border-input bg-card ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </form>
  );
}

/** Below md the search is an icon that opens a field under the header (Framer Motion, a user action). */
function SearchToggle() {
  const t = useTranslations("nav");
  const { reduced } = useMotionPrefs();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("searchLabel")}
        aria-expanded={open}
        data-testid="search-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <X aria-hidden /> : <Search aria-hidden />}
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="search-row"
            initial={reduced ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 top-full border-b border-border bg-background px-4 py-3"
          >
            <SearchForm autoFocus onDone={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MegaMenu({ categories }: { categories: Category[] }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (categories.length === 0) return null;
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="mega-trigger"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {t("categories")}
        <ChevronDown aria-hidden className="size-4" />
      </button>
      {open && (
        <div
          id={panelId}
          data-testid="mega-panel"
          className="absolute start-0 top-full z-50 grid w-[36rem] grid-cols-3 gap-6 rounded-md border border-border bg-popover p-6 text-popover-foreground shadow-float"
        >
          {categories.map((root) => (
            <div key={root.id}>
              <Link
                href={categoryHref(root.slug)}
                onClick={() => setOpen(false)}
                className="font-display text-sm font-semibold text-primary hover:underline"
              >
                {pick(root.name, locale)}
              </Link>
              <ul className="mt-2 space-y-1">
                {(root.children ?? []).map((child) => (
                  <li key={child.id}>
                    <Link
                      href={categoryHref(child.slug)}
                      onClick={() => setOpen(false)}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {pick(child.name, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileNav({ categories }: { categories: Category[] }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogA11y(open, panelRef);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("menu")}
        aria-expanded={open}
        data-testid="mobile-nav-trigger"
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden />
      </Button>
      {open && (
        <div className="fixed inset-0 z-50" data-testid="mobile-nav">
          <button
            type="button"
            aria-label={t("close")}
            className="absolute inset-0 bg-foreground/40"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="absolute inset-y-0 start-0 flex w-80 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-background p-4 shadow-float"
          >
            <div className="flex items-center justify-between">
              <span id={titleId} className="font-display text-xl font-semibold text-primary">
                {t("menu")}
              </span>
              <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setOpen(false)}>
                <X aria-hidden />
              </Button>
            </div>
            <nav aria-label={t("menu")} className="flex flex-col gap-1">
              {NAV.map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  {t(item.key)}
                </Link>
              ))}
              {categories.length > 0 && (
                <p className="mt-3 px-3 text-xs font-semibold text-muted-foreground">
                  {t("categories")}
                </p>
              )}
              {categories.map((root) => (
                <div key={root.id} className="flex flex-col">
                  <Link
                    href={categoryHref(root.slug)}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    {pick(root.name, locale)}
                  </Link>
                  {(root.children ?? []).map((child) => (
                    <Link
                      key={child.id}
                      href={categoryHref(child.slug)}
                      onClick={() => setOpen(false)}
                      className="rounded-md py-1.5 ps-7 pe-3 text-sm text-muted-foreground hover:bg-muted"
                    >
                      {pick(child.name, locale)}
                    </Link>
                  ))}
                </div>
              ))}
            </nav>
            <div className="mt-auto pt-4">
              <LanguageSwitcher testId="mobile-language-switcher" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ADR-018 / UI-04: on the home page the header floats over the hero, transparent with light text, and turns solid
 * after the first scroll. Everywhere else it is the solid sticky header. The hero has a top scrim behind it.
 */
export function SiteHeader({ categories, logoUrl, cartConfig }: Props) {
  const t = useTranslations();
  const pathname = usePathname();
  const overHero = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const light = overHero && !scrolled;
  return (
    <header
      data-testid="site-header"
      data-over-hero={light}
      className={cn(
        "top-0 z-40 w-full border-b transition-colors duration-200",
        overHero ? "fixed inset-x-0" : "sticky",
        light ? "hdr-light border-transparent bg-transparent" : "border-border bg-background",
      )}
    >
      <div className="container-wide relative flex h-16 items-center gap-2 md:h-20 md:gap-4">
        <MobileNav categories={categories} />
        <Link href="/" className="font-display text-2xl font-semibold text-primary">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={t("home.brand")} className="h-8 w-auto" />
          ) : (
            <Wordmark name={t("home.brand")} />
          )}
        </Link>
        {/* The search is the centre of the header: wide from md, an icon below. */}
        <SearchForm className="mx-auto hidden w-full max-w-xl md:block" />
        <nav aria-label={t("nav.main")} className="ms-auto hidden shrink-0 items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="inline-flex h-9 items-center whitespace-nowrap rounded-md px-3 text-sm font-medium hover:bg-muted"
            >
              {t(`nav.${item.key}`)}
            </Link>
          ))}
          <MegaMenu categories={categories} />
        </nav>
        <div className="ms-auto flex items-center gap-1 md:ms-0 lg:ms-2">
          <SearchToggle />
          <div className="hidden lg:block">
            <LanguageSwitcher variant="ghost" />
          </div>
          <FavouritesLink />
          <AccountActions />
          <CartButton config={cartConfig} />
        </div>
      </div>
    </header>
  );
}
