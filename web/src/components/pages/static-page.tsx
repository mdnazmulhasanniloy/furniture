import type { StaticPage } from "@/lib/api/public";
import { pick } from "@/lib/pick";

// Content styling without a typography plugin: tokens + logical utilities only.
const PROSE =
  "text-base leading-relaxed text-foreground [&_h2]:mt-8 [&_h2]:mb-3 [&_h2]:text-2xl [&_h2]:font-semibold " +
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-xl [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:font-semibold " +
  "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:ps-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:ps-6 " +
  "[&_a]:text-primary [&_a]:underline [&_blockquote]:my-4 [&_blockquote]:border-s-4 [&_blockquote]:border-border " +
  "[&_blockquote]:ps-4 [&_blockquote]:text-muted-foreground [&_hr]:my-8 [&_hr]:border-border [&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg";

export function StaticPageView({ page, locale }: { page: StaticPage; locale: string }) {
  const html = pick(page.content, locale);
  return (
    <main className="mx-auto max-w-3xl px-4 py-10" data-testid="static-page">
      <article>
        <h1 className="font-display text-3xl font-semibold">{pick(page.title, locale)}</h1>
        {/* ADR-013: the backend sanitises page HTML on every write (allowlist); the storefront renders it as stored. */}
        <div className={PROSE} data-testid="static-page-content" dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </main>
  );
}
