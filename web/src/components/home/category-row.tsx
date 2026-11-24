import Image from "next/image";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeCategory, HomeSection } from "@/lib/api/public";
import { pick } from "@/lib/pick";
import { cn } from "@/lib/utils";

// ADR-018 / UI-04: editorial bento. Desktop: one large tile (2 x 2) and four small ones; tablet and mobile:
// the large tile spans the full width, the four others sit in two columns of tall tiles. No horizontal scroll.
const MAX = 5;
const FALLBACKS = ["/home/cat-1.jpg", "/home/cat-2.jpg", "/home/cat-3.jpg", "/home/cat-4.jpg", "/home/cat-5.jpg"];

function Tile({ c, index, locale }: { c: HomeCategory; index: number; locale: Locale }) {
  const t = useTranslations("home.categories");
  const large = index === 0;
  const src = c.image?.url ?? FALLBACKS[index % FALLBACKS.length]!;
  return (
    <li className={cn(large ? "col-span-2 lg:row-span-2" : "col-span-1")}>
      <Link
        href={`/shop?category=${encodeURIComponent(c.slug)}`}
        className={cn(
          "zoom-on-hover group relative block h-full w-full overflow-hidden rounded-lg bg-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          large ? "aspect-[4/3] md:aspect-[16/9] lg:aspect-auto" : "aspect-[3/4] lg:aspect-auto",
        )}
      >
        <Image
          src={src}
          alt=""
          fill
          quality={60}
          sizes={large ? "(min-width: 1024px) 50vw, 100vw" : "(min-width: 1024px) 25vw, 50vw"}
          className="object-cover"
        />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-foreground/80 via-foreground/20 via-50% to-transparent" />
        <span className="absolute inset-x-0 bottom-0 p-4 text-primary-foreground md:p-6">
          <span className={cn("block font-display font-bold leading-tight", large ? "text-3xl md:text-4xl" : "text-xl md:text-2xl")}>
            {pick(c.name, locale)}
          </span>
          {typeof c.productCount === "number" ? (
            <span className="mt-1 block text-sm">{t("count", { count: c.productCount })}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function CategoryRow({ section, locale }: { section: HomeSection; locale: Locale }) {
  const t = useTranslations("home.categories");
  const title = pick(section.title, locale) || t("title");
  const cats = section.categories!.slice(0, MAX);
  return (
    <section
      data-testid="home-section-CATEGORY_GRID"
      aria-labelledby={`home-${section.id}`}
      className="container-wide band"
    >
      <div className="flex items-end justify-between gap-4">
        <h2 id={`home-${section.id}`} className="text-3xl md:text-4xl">
          {title}
        </h2>
        <Link href="/shop" className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t("viewAll")}
        </Link>
      </div>
      <ul
        data-testid="category-grid"
        className="mt-8 grid grid-cols-2 gap-3 md:gap-4 lg:h-[600px] lg:grid-cols-4 lg:grid-rows-2"
      >
        {cats.map((c, i) => (
          <Tile key={c.id} c={c} index={i} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
