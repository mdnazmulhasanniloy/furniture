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

`backend/vercel.json`: functions (`api/index.ts` 30 s, `api/socket-io.ts` 300 s, check plan limits), rewrites (socket path to the socket function, everything else to the API), crons (`GET /internal/cron/cleanup`, `0 3 * * *`). Function entry files are created in T-026.

## Backend on serverless (ADR-012)
- `TRUST_PROXY=1` in production. One `PrismaClient` per instance (`globalThis` singleton) and one native `mongodb` client for the Socket.IO adapter/emitter (`maxPoolSize` 2).
- Atlas URL options: `maxPoolSize=5&minPoolSize=0&maxIdleTimeMS=60000&serverSelectionTimeoutMS=5000&retryWrites=true&w=majority`. Connection budget = instances × (Prisma pool + 2). Atlas M0 500, M10 1 500 connections; watch the Atlas connections chart after launch.
- Atlas network access: Vercel standard egress IPs are not fixed, so allow `0.0.0.0/0` with a strong DB user password, or use Vercel static IPs / private link on a paid plan.
- Realtime: WebSocket functions close at the duration limit (about 5 min); clients reconnect and re-fetch (ADR-012 section 3).
- Cron: daily `0 3 * * *` (valid on every plan). Hourly needs Vercel Pro.

## Environments & secrets
`.env` per app, never committed; `.env.example` lists every key (backend keys: ADR-011, ADR-012, `backend/.env.example`). Production values live in Vercel project settings. Repo layout: three separate apps/repos (`backend`, `web`, `admin`) with `npm` (B-018 resolved). CI: GitHub Actions — lint, typecheck, test on PR for each repo.

## Domains (example)
`furnixa.com` (web), `admin.furnixa.com` (admin), `api.furnixa.com` (backend). Cookies follow `AUTH_COOKIE_DOMAIN` (empty = host-only on the origin that proxies `/api`), `AUTH_COOKIE_SAME_SITE` (`lax`), `AUTH_COOKIE_SECURE` (true in production). The socket connects directly to `api.furnixa.com` (`NEXT_PUBLIC_SOCKET_URL` / `VITE_SOCKET_URL`) with the access token in the handshake, so it does not need the cookie.
