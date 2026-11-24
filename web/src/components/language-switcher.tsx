"use client";

import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

export function LanguageSwitcher({
  testId = "language-switcher",
  variant = "outline",
  className,
}: {
  testId?: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const t = useTranslations("lang");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [, startTransition] = useTransition();

  function switchTo(nextLocale: Locale) {
    startTransition(() => {
      router.replace(
        // @ts-expect-error — params match the current pathname's dynamic segments
        { pathname, params },
        { locale: nextLocale },
      );
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} className={className} data-testid={testId}>
          <Globe aria-hidden />
          {t(locale as Locale)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-testid="language-menu"
        className="min-w-(--radix-dropdown-menu-trigger-width)"
      >
        {routing.locales.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => switchTo(l)}>
            {t(l)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
