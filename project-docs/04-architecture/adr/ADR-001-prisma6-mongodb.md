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
