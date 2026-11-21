# Backend — Furnixa API

**Stack:** Node 22 · Express 5 · TypeScript (strict) · Prisma ORM **6.x** (MongoDB — never upgrade to 7, see ADR-001) · zod · Nodemailer · Socket.IO · Vitest + Supertest.
**Docs:** `../project-docs/` — start at `00-INDEX.md`. Tasks: `../project-docs/05-delivery/tasks/backend.md`.
**Contract:** `../project-docs/04-architecture/api-spec.yaml` · **Schema:** `../project-docs/04-architecture/data-model.md`.

## Commands

`npm run dev` · `npm run build` · `npm run typecheck` · `npm run lint` · `npm test` · `npm run db:push` · `npm run seed`
Local infra: MongoDB Atlas + Gmail SMTP (see `.env.example`); no Docker needed. Deployed on Vercel (ADR-012): `api/index.ts`, `api/socket-io.ts`, `vercel.json`.

## Structure

`src/modules/<name>/{routes,controller,service,schema}.ts` — controllers handle HTTP only; business rules live in services; validation with zod in `schema.ts`. Shared code in `src/lib`, `src/middleware`.

## Rules

1. Read the task and only its linked docs before starting. Plan first for multi-file work.
2. Update `api-spec.yaml` and `data-model.md` **before** changing endpoints or `schema.prisma`.
3. Anything unclear → add to `../project-docs/05-delivery/blockers.md` with status `blocked` and stop. Never guess.
4. A task is done only when every acceptance criterion of its requirement has a passing test named with the requirement ID.
5. After each task: update task status, `implementation-plan.md` if affected, and `changelog.md`; run `node ../scripts/traceability.mjs`.
6. Errors always use the `Error` schema (`code`, `message`, `details`, `requestId`). Money is integer minor units.
7. All user-facing text (emails, notification bodies) exists in `en` and `ar`.

## Never

- Remove/rename fields in `schema.prisma` without an ADR + data-migration script.
- Commit `.env` or secrets. Use `.env.example`.
- Invent requirements, add Redis/queues (ADR-012), use in-memory state for rate limits or sockets, or weaken/delete tests to make them pass.
