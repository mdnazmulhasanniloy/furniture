# System Architecture

```
            ┌──────────────────────┐        ┌──────────────────────┐
 Customer ─▶│  web  (Next.js 15)   │        │ admin (Vite + React) │◀─ Admin
            │  SSR/ISR, next-intl  │        │  SPA, react-i18next  │
            └─────────┬────────────┘        └──────────┬───────────┘
                      │ REST /api/v1  + Socket.IO (wss)│
                      ▼                                ▼
            ┌───────────────────────────────────────────────────┐
            │ backend: Node 22 · Express 5 · TypeScript          │
            │ modules: auth, users, catalog, cart, orders,       │
            │ notifications, cms, uploads, dashboard             │
            │ Prisma ORM 6.x · zod · Nodemailer · Socket.IO      │
            └──────┬───────────────┬───────────────┬────────────┘
                   ▼               ▼               ▼
            MongoDB Atlas     SMTP provider    Cloudflare R2 (ADR-010)
            (replica set)     (Nodemailer)     image storage (presigned PUT)
```

## Decisions (see `adr/`)

| ADR | Decision |
|---|---|
| ADR-001 | Prisma **6.x** with MongoDB (Prisma 7 has no MongoDB connector). Schema sync via `prisma db push`, not migrations. |
| ADR-002 | Website = **Next.js (App Router)** for SEO/SSR; Admin = **Vite + React SPA**. |
| ADR-003 | Auth = email OTP + password, JWT access (15 m) + rotating refresh cookie (30 d); amended by ADR-011 (argon2id, lockout, session cap, CSRF). |
| ADR-004 | UI = **shadcn/ui + Tailwind** base, **Magic UI** for showcase; daisyUI not used by default. |
| ADR-005 | No Redis/queue in MVP: in-memory rate limiting, emails sent in-process (async, failures logged), single backend instance. |
| ADR-006 | Localized fields stored as embedded `{ en, ar }` composite types; default locale `ar`. |
| ADR-007 | ~~Cloudinary~~ — superseded by ADR-010. |
| ADR-010 | Images on **Cloudflare R2**, uploaded by the admin browser with presigned PUT URLs. |
| ADR-011 | Auth hardening, Sentry, ports (API 4100, web 3100, admin 3101) and the backend env keys. |
| ADR-008 | Saudi market: **SAR** (integer halalas), admin-managed delivery cities, `+966` phones. |
| ADR-009 | Delivery fee (base + optional per-city override) and **VAT** are admin-managed settings (default 0), snapshotted on each order. |

## Backend module layout

```
backend/src/
  app.ts                # express app, middleware
  server.ts             # http + socket.io bootstrap
  config/env.ts         # zod-validated env
  lib/ prisma.ts mailer.ts logger.ts jwt.ts socket.ts
  middleware/ auth.ts role.ts validate.ts error.ts rateLimit.ts
  modules/<name>/ <name>.routes.ts <name>.controller.ts <name>.service.ts <name>.schema.ts
  emails/ templates/{en,ar}/*.ts
  utils/
tests/  (vitest + supertest; mongodb-memory-server replica set)
```

Layering: routes → controller (HTTP only) → service (business rules, Prisma) . Services emit domain events via a tiny in-process `EventEmitter` (`order.created`, `order.statusChanged`) consumed by `notifications` (DB + Socket.IO) and `mail`.

## Real-time

Socket.IO namespace `/`; handshake `auth.token` = access token. Rooms: `user:{userId}`, `admins`. Events: `notification:new` (payload = Notification), `order:updated` ({id, status}). Client re-fetches unread count on reconnect.

## Stock consistency

Order placement runs inside `prisma.$transaction`: for each item `updateMany({ where: { id, stock: { gte: qty }, status: PUBLISHED }, data: { stock: { decrement: qty } } })`; if `count === 0` → throw `OUT_OF_STOCK` → whole transaction rolls back. Requires replica set (ADR-001).

## Content caching (web)

Next.js fetches CMS/catalog with `revalidate: 60` and tag-based caching; backend calls the web's `/api/revalidate` endpoint (shared secret) after admin edits for instant updates.
