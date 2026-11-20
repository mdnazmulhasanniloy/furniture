# Test Plan

## Levels
| Level | Tool | Where |
|---|---|---|
| Unit | Vitest | all repos |
| API integration | Vitest + Supertest + `mongodb-memory-server` (replica set mode) | backend `tests/` |
| Contract | OpenAPI response validation against `project-docs/04-architecture/api-spec.yaml` | backend T-019 |
| Component | Vitest + Testing Library | web, admin |
| E2E | Playwright (projects: `en`, `ar`, mobile) | web, admin |
| Accessibility | `@axe-core/playwright` | web, admin |

## Rules
- Each acceptance criterion in the PRD gets ≥ 1 test named with its ID, e.g. `it('AUTH-01 · locks OTP after 5 wrong attempts')`. `grep -r "AUTH-01" tests/` must find it.
- Tests never deleted or weakened to make a task pass; reviewers check diff of `tests/` on every PR.
- Email: captured via a test transport (Nodemailer `jsonTransport`); OTP read from captured mail in tests.
- Socket: `socket.io-client` in backend tests (websocket transport); Playwright two-context test for live toast. Cross-instance delivery is tested with two server instances sharing the MongoDB adapter collection (`mongodb-memory-server` replica set).

## Critical scenarios
1. Two customers buy the last resale item simultaneously → one order, one OUT_OF_STOCK.
2. Admin cancels a CONFIRMED order → stock restored, customer notified + emailed (ar).
3. Arabic user completes the full journey J1 with RTL layout and Arabic emails.
4. Refresh token reuse → all sessions revoked.
5. Admin publishes product without Arabic fields → blocked.
6. Defaults: fresh seed (vatRate 0, deliveryFee 0, no threshold) → cart/checkout/order show "Free delivery" and no VAT line.
7. Per-city fee: city with override uses it; city without override uses the base fee; with no base fee → 0.
8. VAT: `vatRate` > 0 with "Apply VAT to delivery fee" on/off changes the VAT base; inclusive vs exclusive totals; rate 0 hides VAT everywhere.
9. Snapshot: place an order, then change fee, VAT rate and toggles → the order, its invoice and `GET /orders/:id` are unchanged.
10. `expectedTotal` mismatch after an admin changes a setting → 409 `PRICE_CHANGED`, no stock decrement, cart refreshed.
11. Saudi market: address in a deactivated city → 422 `OUT_OF_DELIVERY_AREA`; phones `05…`, `5…`, `+966…`, `00966…` normalize to `+9665XXXXXXXX`, landlines rejected; `/` redirects to `/ar`; prices formatted with SAR for `ar-SA` / `en-SA`.
12. Customer cancels PENDING order → CANCELLED; CONFIRMED → 409 `INVALID_TRANSITION`.
13. Image upload (S3 client mocked): presign rejects non-image types and > 5 MB; key format and 300 s expiry; removing an image from a product/banner or deleting a product deletes the R2 objects; a failed delete is logged and the request still succeeds.
14. Auth hardening: argon2id verification; lockout after `LOGIN_MAX_FAILURES` and reset on success; `MAX_ACTIVE_SESSIONS` revokes the oldest session; refresh/logout without a valid CSRF token → 403; 30-day refresh TTL.
15. Config: the API refuses to start in production without the required secrets and `CORS_ALLOWED_ORIGINS`; Sentry is not initialised when `SENTRY_DSN` is empty.
16. Reconnect catch-up: a notification created while the socket was disconnected is shown after the reconnect (bell count, list, toast) — backend (socket.io-client), web and admin tests.
17. Cross-instance realtime: an event emitted by the REST side (mongo-emitter) reaches a client connected to a different socket server instance.
18. Rate limiting across instances: two app instances share the `RateLimit` counter; the TTL index exists; the limiter fails open when MongoDB errors.
19. Cron cleanup: `GET`/`POST /internal/cron/cleanup` with `Authorization: Bearer` or `x-cron-secret` removes expired/consumed OTPs, expired/revoked refresh tokens and old adapter documents and keeps the rest; wrong or missing secret → 401; a user JWT → 401; unset `CRON_SECRET` → route absent.
20. Names and OTP lifetime: register requires `firstName` and `lastName`; OTP expires after `OTP_TTL_SECONDS`.
