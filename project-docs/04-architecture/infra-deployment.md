# Infra & Deployment (proposal, pending B-005)

| Component | Dev | Production (proposed) |
|---|---|---|
| MongoDB | Docker `mongo:7` started as single-node **replica set** (`--replSet rs0`) | MongoDB Atlas (M0/M10) |
| Backend | `npm run dev` (tsx watch) :4100 | **Open (B-017):** Render/Railway/VPS (PM2), 1 instance — or Vercel (the `.env` hints at it, but Socket.IO and in-memory rate limiting do not fit serverless) |
| Web | `next dev` :3100 | Vercel |
| Admin | `vite` :3101 | Vercel / Netlify static |
| Mail | Mailpit (Docker) :8025 | SMTP provider |
| Images | Cloudflare R2 bucket, keys under `furnixa/development/…` | Cloudflare R2 bucket, keys under `furnixa/production/…` (ADR-010) |

`docker-compose.yml` at the workspace root provides mongo (replica set) + mailpit for local dev.

## Environments & secrets
`.env` per app, never committed; `.env.example` lists every key (backend keys: ADR-011, `backend/.env.example`). Repo layout (three repos vs pnpm monorepo) is open (B-018). CI: GitHub Actions — lint, typecheck, test on PR for each repo.

## Domains (example)
`furnixa.com` (web), `admin.furnixa.com` (admin), `api.furnixa.com` (backend). Cookies follow `AUTH_COOKIE_DOMAIN` (empty = host-only on the origin that proxies `/api`), `AUTH_COOKIE_SAME_SITE` (`lax`), `AUTH_COOKIE_SECURE` (true in production).
