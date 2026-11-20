# Furnixa — Furniture marketplace (new + pre-owned)

Bilingual (EN/AR) furniture store with Cash on Delivery, admin-managed content, email OTP auth and live notifications.
Follows the **Claude-Driven Development Playbook**: docs before code, contract first, no guessing.

```
furnixa/
├── project-docs/   ← single source of truth (start at 00-INDEX.md)
├── backend/        ← Express + TS + Prisma 6 + MongoDB + Socket.IO + Nodemailer
├── web/            ← Next.js customer website (en/ar, RTL)
├── admin/          ← Vite + React admin dashboard
├── scripts/        ← traceability.mjs, i18n-check.mjs
├── .claude/commands/ ← /gen-prd, /change-request (workspace level)
└── docker-compose.yml ← Mongo replica set + Mailpit
```

## Where we are
Docs v0.5 (Saudi market, SAR, `ar` default, admin-managed delivery fee/VAT defaulting to 0; ADR-007…009 accepted; `schema.prisma` aligned) → **next: final sign-off of the remaining open blockers** (`project-docs/05-delivery/blockers.md`: B-005, B-006, B-007, B-009, B-013…B-015).
After sign-off, in any repo: `/next-task` → approve plan → build + tests → `/review-task T-xxx` → `/sync-docs T-xxx` → `/clear`.

## Local setup (after sign-off)
```bash
docker compose up -d
cd backend && cp .env.example .env && npm i && npm run db:push && npm run seed && npm run dev
cd web && cp .env.example .env.local && npm i && npm run dev
cd admin && cp .env.example .env && npm i && npm run dev
```
Mail UI: http://localhost:8025
Ports: API http://localhost:4100 · web http://localhost:3100 · admin http://localhost:3101

## Checks
`node scripts/traceability.mjs` — every requirement has a task · `npm run i18n:check` in web/admin — en/ar key parity.
