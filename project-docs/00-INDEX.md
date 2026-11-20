# Project Docs Index — Furnixa

Single source of truth. Numbered in production order. Read only what your task links to.

| Path | What it is | Read it when |
|---|---|---|
| `01-discovery/client-notes-2026-11-20.md` | Raw client brief + translation (SRC-001) , blocker answers (SRC-002) , Saudi-market correction (SRC-003) and fee/VAT answer (SRC-004) | Checking where a requirement came from |
| `01-discovery/glossary.md` | Domain terms | Naming things |
| `01-discovery/open-questions.md` | Questions for client | Preparing client calls |
| `02-product/PRD.md` | Requirements with IDs + acceptance criteria | Every feature task |
| `02-product/user-journeys.md` | End-to-end flows J1–J6 | E2E tests, UX work |
| `02-product/roles-permissions.md` | Admin vs customer matrix | Auth, routing, middleware |
| `03-design/design-system.md` | Colours, type, motion, RTL rules | Any UI task |
| `03-design/screen-flow.md` | Routes for web + admin | Routing, navigation |
| `03-design/screen-specs.md` | Per-screen content and states | Building a screen |
| `04-architecture/system-architecture.md` | Components, layering, real-time, stock logic | Backend + integration work |
| `04-architecture/data-model.md` | Collections, fields, enums | Schema / Prisma changes |
| `04-architecture/api-spec.yaml` | OpenAPI 3.1 contract | Any endpoint or API call |
| `04-architecture/integrations.md` | Nodemailer, Socket.IO, Cloudflare R2, Sentry, revalidation | Integration tasks |
| `04-architecture/infra-deployment.md` | Envs, Vercel hosting, Atlas, Gmail | DevOps |
| `04-architecture/adr/` | Decision records (ADR-001…012; 005 = no Redis (superseded by 012 = Vercel serverless deployment), 007 = Cloudinary (superseded by 010 = Cloudflare R2), 011 = auth hardening + env, 008 = Saudi market: SAR, cities, phones, 009 = delivery fee + VAT settings) | Before changing a decision |
| `05-delivery/implementation-plan.md` | Milestones + critical path | Planning |
| `05-delivery/tasks/{backend,web,admin}.md` | Tasks T-xxx with deps and done criteria | Picking the next task |
| `05-delivery/traceability.md` | Requirement → task matrix | Completeness checks |
| `05-delivery/blockers.md` | Open questions blocking work | Anything unclear |
| `05-delivery/test-plan.md` | Test strategy | Writing tests |
| `05-delivery/changelog.md` | Dated changes | After each task |
