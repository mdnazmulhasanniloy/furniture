# ADR-001: Prisma ORM 6.x with MongoDB

Status: Accepted (2026-11-20) · Source: SRC-001.3

## Context
Client requires Prisma + MongoDB. Prisma ORM 7 ships without a MongoDB connector; Prisma's docs direct MongoDB users to stay on the latest 6.x release (6.19 at time of writing). Prisma's MongoDB connector needs a replica set for transactions/nested writes.

## Decision
- Pin `prisma` and `@prisma/client` to `^6.19.0`. Do **not** run the v7 upgrade.
- Schema sync with `prisma db push` (MongoDB has no Prisma migrations). The "don't edit merged migrations" rule maps to: never rename/remove a field in `schema.prisma` without a data-migration script in `backend/scripts/migrations/` and an ADR.
- Dev and prod MongoDB must run as a replica set.

## Consequences
+ Meets client stack. − No Prisma 7 features; re-evaluate when Prisma ships stable MongoDB support (Prisma Next).

## Amendment 2026-11-24 (T-029: prisma CLI audit advisories accepted as risk)
`npm audit` flags the `prisma` CLI devDependency chain with 4 high advisories, all via `@prisma/config`: `deepmerge-ts` <8.0.0 stack exhaustion (GHSA-ggr8-5vv4-36mx) and `effect` ≤3.22.0 ReDoS (GHSA-7589-6fvf-x4pw). npm's only proposed fix is `prisma@7.10.1`, which this ADR forbids (v7 has no MongoDB connector). **Decision: accept the risk.** The chain is build-time only (`prisma generate` / `db push`); `@prisma/client` (the runtime dependency) is not flagged. Do not take the suggested fix and never run `npm audit fix --force`; re-check `npm audit` for a 6.x backport at every dependency bump (blocker B-027). Lifting the v6 pin remains its own future decision, not a security chore.
