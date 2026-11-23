// Next.js 16 renamed the middleware convention to proxy (nextjs.org/docs → upgrading/version-16).
import createIntlMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18nRouting = createIntlMiddleware(routing);

export default function proxy(request: NextRequest) {
  return handleI18nRouting(request);
}

export const config = {
  // Skip the API proxy rewrite (/api/*), Next internals and static files.
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
