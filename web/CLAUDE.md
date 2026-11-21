# Web — Furnixa customer website

**Stack:** Next.js 15 (App Router) · TypeScript strict · Tailwind CSS v4 · shadcn/ui · Magic UI · Framer Motion · GSAP (+ScrollTrigger) · AOS · next-intl (`/en`, `/ar`) · TanStack Query · Zustand (cart) · socket.io-client · Vitest + Testing Library · Playwright.
**Docs:** `../project-docs/00-INDEX.md`. Tasks: `../project-docs/05-delivery/tasks/web.md`. API contract: `../project-docs/04-architecture/api-spec.yaml`. Design: `../project-docs/03-design/`.

## Commands
`npm run dev` (:3100) · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run e2e` · `npm run i18n:check`

## Rules
1. Read the task and only its linked docs first; plan before multi-file work.
2. Colours/fonts/radii only from tokens in `src/app/globals.css` (from `design-system.md`). No hex values in components.
3. RTL: logical utilities only (`ms-`, `pe-`, `start-`, `text-start`); directional icons get `rtl:rotate-180`; GSAP x-offsets flip in RTL.
4. Every UI string goes in `messages/en.json` **and** `messages/ar.json`; `npm run i18n:check` must pass. Localized API fields: `pick(field, locale)` helper with `en` fallback.
5. Motion: Framer Motion for components, GSAP only on the home page, AOS for simple reveals; always respect `prefers-reduced-motion`.
6. API changes are never made here — if the contract is missing something, log a blocker.
7. Done = acceptance criteria covered by tests in **both** locales; then update task status + changelog.
8. API errors: the API is English-only. Never show the API message; map error.code to messages/en.json and ar.json, with a generic fallback.

## Never
Commit `.env*`, invent requirements, add a second theme system (daisyUI) without an ADR, or weaken tests.
