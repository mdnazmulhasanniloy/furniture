// Next.js 16 renamed the middleware convention to proxy (nextjs.org/docs → upgrading/version-16).
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export default function proxy(request: NextRequest) {
  // I18N-01 / ADR-002 amendment: `/` goes to the default locale (ar) regardless of the
  // browser's Accept-Language, unless the visitor chose a locale before (NEXT_LOCALE).
  if (request.nextUrl.pathname === "/" && !request.cookies.has("NEXT_LOCALE")) {
    const url = request.nextUrl.clone();
    url.pathname = `/${routing.defaultLocale}`;
    return NextResponse.redirect(url);
  }
  return handleI18nRouting(request);
}

export const config = {
  // Skip the API proxy rewrite (/api/*), Next internals and static files.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
