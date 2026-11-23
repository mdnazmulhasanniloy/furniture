# Infra & Deployment (ADR-012: all three apps on Vercel)

| Component | Dev | Production |
|---|---|---|
| MongoDB | MongoDB Atlas (a dev cluster or database; Docker no longer required, SRC-007.4) | MongoDB Atlas (M10+ recommended; M0 for demos) |
| Backend | `npm run dev` (tsx watch) :4100, one Node process mounting REST and Socket.IO | Vercel project `furnixa-api`: `api/index.ts` (Express) + `api/socket-io.ts` (Socket.IO), `backend/vercel.json`, Vercel Cron |
| Web | `next dev` :3100 | Vercel project `furnixa-web` |
| Admin | `vite` :3101 | Vercel project `furnixa-admin` (static, SPA rewrite) |
| Mail | Gmail SMTP (`smtp.gmail.com:587`, app password) | Gmail SMTP for the MVP; move to a transactional provider before launch volume |
| Images | Cloudflare R2 bucket, keys under `furnixa/development/…` | Cloudflare R2 bucket, keys under `furnixa/production/…` (ADR-010) |

`docker-compose.yml` (Mongo replica set + Mailpit) is **optional**, kept only as an offline fallback; the documented path is Atlas + Gmail. Tests use `mongodb-memory-server` (replica set) and a Nodemailer `jsonTransport`, so no external services.

## Vercel projects
| Project | Root dir | Framework / build | Environment | Domain |
|---|---|---|---|---|
| `furnixa-api` | `backend` | Other; build `npm run build` (`prisma generate` + `tsc`); install command `npm install` | every key of `backend/.env.example`; `TRUST_PROXY=1`; `CRON_SECRET` (Vercel sends it as `Authorization: Bearer`) | `api.furnixa.com` |
| `furnixa-web` | `web` | Next.js | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SOCKET_URL`, `REVALIDATE_SECRET` | `furnixa.com` |
| `furnixa-admin` | `admin` | Vite; build `npm run build`; output `dist`; rewrite `/(.*)` to `/index.html` | `VITE_API_URL`, `VITE_SOCKET_URL` | `admin.furnixa.com` |

`backend/vercel.json`: functions (`api/index.ts` 30 s, `api/socket-io.ts` 300 s, check plan limits), one rewrite (everything **except** `/api/socket-io/*` to the API: `"/((?!api/socket-io).*)"`), crons (`GET /internal/cron/cleanup`, `0 3 * * *`). The socket function default-exports an `http.Server` and the platform routes `/api/socket-io/*` — including the websocket upgrade — to it natively (official Vercel WebSocket pattern); **no rewrite may match the socket path**, because upgrade requests pass through rewrites before upgrading. A conformance test (`NFR-08`, T-026) locks `vercel.json` to this shape, including that the socket path never matches the catch-all.

**Rewrite-by-destination routing (2026-11-23):** Vercel's backend-framework routing invokes functions with `req.url` set to the rewrite *destination* (`/api/index`, `/api/socket-io`), so each rewrite carries the requested path in the `__originalPath` destination query; the app's first middleware and the socket function's upgrade listener restore it (`src/lib/vercelUrl.ts`, tested with a rewritten HTTP request and a rewritten websocket upgrade). **Vercel-compiler type-check:** `npm run build:vercel` type-checks everything reachable from `api/` with the same resolver the Vercel function compiler uses (require-condition view in ESM files, `scripts/vercel-typecheck.mjs`) — run it before deploying; a package it flags gets a `paths` pin to its ESM types in `tsconfig.json` (helmet is pinned). `engines.node` is pinned to `22.x` so Vercel builds and runs on the same Node major as local dev.

**Deployment Protection:** when Vercel Deployment Protection is on (default for previews), automated checks authenticate with a bypass secret: Vercel → Project → Settings → Deployment Protection → "Protection Bypass for Automation" → generate a secret, then set it as `VERCEL_PROTECTION_BYPASS` in `backend/.env.preview-check`. The preview check sends it as the `x-vercel-protection-bypass` header on every HTTP request and in the websocket handshake.

## Databases per environment (T-026)

All three environments share one Atlas cluster but use **separate databases** (different database name in the connection string) and **separate DB users**, each with `readWrite` on its own database only:

| Environment | Database (in `DATABASE_URL`) | Notes |
|---|---|---|
| Local dev | `furniture_dev` | `backend/.env` |
| Vercel Preview env | `furniture_preview` | set `DATABASE_URL` in the Vercel Preview environment |
| Vercel Production env | `furniture_prod` | set `DATABASE_URL` in the Vercel Production environment |

Seed the preview database once with `npm run seed` (run locally with `DATABASE_URL` pointed at `furnixa_preview`). `SEED_DEMO_DATA=true` is allowed on preview — the preview check's `--long` step needs at least one published product — but **never on production** (the seed refuses it when `NODE_ENV=production`).

## Backend on serverless (ADR-012)
- `TRUST_PROXY=1` in production. One `PrismaClient` per instance (`globalThis` singleton) and one native `mongodb` client for the Socket.IO adapter/emitter (`maxPoolSize` 2).
- Atlas URL options: `maxPoolSize=5&minPoolSize=0&maxIdleTimeMS=60000&serverSelectionTimeoutMS=5000&retryWrites=true&w=majority`. Connection budget = instances × (Prisma pool + 2). Atlas M0 500, M10 1 500 connections; watch the Atlas connections chart after launch.
- Atlas network access (T-026): Atlas Network Access **must allow `0.0.0.0/0`**, because Vercel has no fixed egress IPs on our plan. Compensating controls: a long random password per DB user, and a **separate DB user per environment with `readWrite` only on its own database** (see "Databases per environment"). Vercel static IPs / private link remain an option on a higher plan.
- Realtime: WebSocket functions close at the duration limit (about 5 min); clients reconnect and re-fetch (ADR-012 section 3).
- Cron: daily `0 3 * * *` (valid on every plan). Hourly needs Vercel Pro. **Vercel Cron fires only on the production deployment** of a project — on a preview the cleanup route is exercised manually (preview check step 4) and the cron registration is confirmed in the dashboard (Settings → Cron Jobs).

## Environments & secrets
`.env` per app, never committed; `.env.example` lists every key (backend keys: ADR-011, ADR-012, `backend/.env.example`). Production values live in Vercel project settings. Repo layout: three separate apps/repos (`backend`, `web`, `admin`) with `npm` (B-018 resolved). CI: GitHub Actions — lint, typecheck, test on PR for each repo.

## Preview deployment check (T-026)

`backend/scripts/preview-check.ts` verifies a deployed preview (or production) end to end. Credentials come **only from env**, loaded with dotenv from the git-ignored `backend/.env.preview-check` (template: `backend/.env.preview-check.example`); nothing secret is ever printed or passed as a CLI argument.

Run from `backend/`:

```
npx tsx scripts/preview-check.ts          # steps 1–4
npx tsx scripts/preview-check.ts --long   # adds step 5 (~6 minutes)
```

Env keys: `PREVIEW_URL` (deployment base URL), `PREVIEW_EMAIL` + `PREVIEW_PASSWORD` (a verified account; **must be an admin** for `--long`), `CRON_SECRET` (optional — skips step 4 when empty), `VERCEL_PROTECTION_BYPASS` (optional — sent as `x-vercel-protection-bypass` on HTTP requests and in the socket handshake when set), and for `--long` only: `PREVIEW_CUSTOMER_EMAIL` + `PREVIEW_CUSTOMER_PASSWORD` (a verified customer).

Steps (each prints `PASS step N — …` / `FAIL step N — …`, final line `PREVIEW PASS` / `PREVIEW FAIL`):
1. `GET /health` → 200.
2. `POST /api/v1/auth/login` → 200 with an access token.
3. Websocket connect to `/api/socket-io/socket.io` (`transports: ['websocket']`, token in the handshake) → `connect`.
4. `GET /internal/cron/cleanup` with `Authorization: Bearer <CRON_SECRET>` → 200 with the five counts (manual stand-in for the scheduled cron, which fires only on production).
5. `--long` (ADR-012 §3, NFR-08): the customer places a real order (demo product + a check address), holds a socket open until the platform closes it at the duration limit (measured and reported), the admin confirms the order **during the gap**, the socket reconnects automatically, and `GET /notifications` after the reconnect must contain the notification created while disconnected. The order is cancelled afterwards (stock restored).

## Vercel plan (record after the preview run — T-026)

To fill in from the owner's preview run (keep the history):

| Date | Deployment | Plan | Fluid Compute | Max duration (API / socket) | Measured socket disconnect (`--long`) | Notes |
|---|---|---|---|---|---|---|
| _pending_ | | | | | | |

**Plan licence note:** the Vercel **Hobby plan is for personal, non-commercial use only** — the client's production store must run on a paid plan (Pro or higher). Owner to confirm the hosting cost with the client: **blocker B-026**.

## Domains (example)
`furnixa.com` (web), `admin.furnixa.com` (admin), `api.furnixa.com` (backend). Cookies follow `AUTH_COOKIE_DOMAIN` (empty = host-only on the origin that proxies `/api`), `AUTH_COOKIE_SAME_SITE` (`lax`), `AUTH_COOKIE_SECURE` (true in production). The socket connects directly to `api.furnixa.com` (`NEXT_PUBLIC_SOCKET_URL` / `VITE_SOCKET_URL`) with the access token in the handshake, so it does not need the cookie.
