# Implementation Plan

Gate 0 — **Sign-off**: client reviews PRD, design system, API spec; blockers B-001, B-002, B-003, B-004 (now R2), B-008, B-010, B-011, B-012, B-016 answered and the Saudi-market, Cloudinary and fee/VAT changes confirmed (SRC-005). Still open, non-blocking (draft assumptions): B-013 ZATCA, B-014 landlines, B-015 digits/calendar; B-005/6/7/9 unchanged. No code before this gate (Team rule 1).

| Milestone | Scope | Tasks | Exit criteria |
|---|---|---|---|
| M1 Foundation (wk 1) | Repos, schema, design tokens, i18n shells | T-001, T-002, T-003, T-030, T-060 | All three apps boot; seed runs; en/ar switching works |
| M2 Auth (wk 2) | OTP auth end-to-end in web + admin | T-004–T-007, T-027, T-017, T-031, T-037, T-061 | Register→OTP→login works in both apps & locales |
| M3 Catalog & CMS (wk 3–4) | Products, categories, uploads, CMS, home page | T-008–T-011, T-028, T-032–T-035, T-041, T-062–T-064, T-067–T-070 | Admin edits reflect on website within 60 s |
| M4 Commerce (wk 5) | Cart, checkout COD, orders, pricing | T-012–T-015, T-021, T-022, T-036, T-038, T-039, T-065, T-066 | Concurrent-stock test passes; full order lifecycle |
| M5 Real-time & polish (wk 6) | Socket.IO, dashboard, a11y, perf, hardening | T-016, T-018, T-019, T-040, T-042, T-071, T-072 | Live notification < 2 s; Lighthouse ≥ 90; spec conformance green |
| M6 UAT & launch (wk 7) | Client UAT, fixes, deploy | — | Client sign-off |

Critical path: T-001 → T-002 → T-004 → T-005 → T-010 → T-012 → T-013 → T-014 → T-016.
Parallelism: web and admin start at M1 against `api-spec.yaml` with mocked responses (MSW) until backend endpoints land.
