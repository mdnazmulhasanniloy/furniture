# ADR-005: No Redis / Kafka / queues in MVP

Status: **Superseded by ADR-012 (2026-11-20)** · Source: SRC-001.11 · Kept for history. Still true: no Redis, Kafka or queues. No longer true: in-memory rate limiting, single instance, no Socket.IO adapter.

- Rate limiting: `express-rate-limit` default in-memory store.
- Emails: sent in-process, errors logged; OTP send failures surface to the user.
- Domain events: Node `EventEmitter` in-process.
- Socket.IO: single backend instance, no adapter.
Consequence: backend must run as **one instance** until Redis is introduced.
