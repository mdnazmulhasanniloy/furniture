import Image from "next/image";
import { useTranslations } from "next-intl";

import { Arch } from "@/components/arch";
import { ImagePlaceholder } from "@/components/brand";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import type { HomeSection } from "@/lib/api/public";
import { pick } from "@/lib/pick";

/**
 * "Shop by room": a horizontal row of arch tiles (3:4), the name under each. Scroll-snap to the inline start,
 * with a peek of the next tile. The row follows the document direction, so it mirrors in RTL.
 */
export function CategoryRow({ section, locale }: { section: HomeSection; locale: Locale }) {
  const t = useTranslations("home");
  const title = pick(section.title, locale);
  return (
    <section
      data-testid="home-section-CATEGORY_GRID"
      aria-labelledby={`home-${section.id}`}
      className="mx-auto max-w-7xl py-12 md:py-20"
    >
      <h2 id={`home-${section.id}`} className="px-4 text-3xl font-semibold md:px-8">
        {title}
      </h2>
      <ul
        data-testid="category-row"
        className="mt-8 flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-ps-4 px-4 pb-4 md:scroll-ps-8 md:gap-6 md:px-8 [scrollbar-width:thin]"
      >
        {section.categories!.map((c) => (
          <li key={c.id} className="w-36 shrink-0 snap-start sm:w-44 lg:w-52">
            <Link
              href={`/shop?category=${encodeURIComponent(c.slug)}`}
              className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              <Arch ratio="3/4">
                {c.image?.url ? (
                  <Image
                    src={c.image.url}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 13rem, (min-width: 640px) 11rem, 9rem"
                    className="object-cover"
                  />
                ) : (
                  <ImagePlaceholder name={t("brand")} />
                )}
              </Arch>
              <span className="mt-3 block text-sm font-medium">{pick(c.name, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
