# Admin — Furnixa dashboard

**Stack:** Vite · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui · React Router · TanStack Query + TanStack Table · react-hook-form + zod · react-i18next (en/ar, RTL) · Recharts · dnd-kit · Tiptap · Framer Motion · socket.io-client · Vitest + Testing Library · Playwright.
**Docs:** `../project-docs/00-INDEX.md`. Tasks: `../project-docs/05-delivery/tasks/admin.md`. API: `../project-docs/04-architecture/api-spec.yaml`. Design: `../project-docs/03-design/` (screens A-01…A-06).

## Commands
`npm run dev` (:3101) · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run e2e` · `npm run i18n:check`

## Rules
1. Read the task and only its linked docs first; plan before multi-file work.
2. Tokens only from `src/index.css` (light + dark). Status colours per `design-system.md`.
3. Every localized entity form shows `English | العربية` tabs; publishing requires both.
4. UI strings in `src/locales/en.json` + `ar.json`; logical CSS properties for RTL.
5. Only show actions the API allows (e.g. allowed next order statuses); the backend is still the authority.
6. Missing API capability → blocker, not a workaround.
7. Done = tests for each acceptance criterion, both locales; update task status + changelog.

## Never
Commit `.env*`, store tokens in localStorage (access token in memory, refresh via httpOnly cookie), invent requirements, weaken tests.
