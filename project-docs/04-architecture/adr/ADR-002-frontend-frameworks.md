# ADR-002: Next.js for website, Vite + React for admin

Status: **Accepted 2026-11-20** (client confirmed, SRC-002.5, B-010) · Source: SRC-001.4 (framework not specified)

## Decision
- **web**: Next.js 15 App Router, TypeScript, Tailwind v4, `next-intl` (locale routing `/en`, `/ar`), TanStack Query for client data, Zustand for cart. SSR/ISR gives SEO for product pages.
- **admin**: Vite + React 19 + TypeScript, React Router, TanStack Query + TanStack Table, react-hook-form + zod, `react-i18next`. No SEO need, simpler deploy.

**Amendment 2026-11-20 (SRC-003.4):** `next-intl` is configured with `defaultLocale: 'ar'`; `/` redirects to `/ar` unless the visitor previously chose `en`. The admin app also defaults to `ar` and remembers the user's choice.

## Alternatives
Both in Next.js (one framework, but admin gains nothing from SSR). Plain React for web (loses SEO).
