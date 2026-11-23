import { Link } from "@/i18n/navigation";
import { safeHref } from "@/lib/home";

/** Link for an admin-entered href: same-site paths via the locale-aware Link, https externally. */
export function CtaLink({
  href,
  className,
  children,
}: {
  href: string | null | undefined;
  className?: string;
  children: React.ReactNode;
}) {
  const safe = safeHref(href);
  if (!safe) return null;
  if (safe.external) {
    return (
      <a href={safe.href} className={className} rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return (
    <Link href={safe.href} className={className}>
      {children}
    </Link>
  );
}
