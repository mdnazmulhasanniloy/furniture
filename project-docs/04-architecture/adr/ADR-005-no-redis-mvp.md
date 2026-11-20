# ADR-005: No Redis / Kafka / queues in MVP

Status: Accepted · Source: SRC-001.11

- Rate limiting: `express-rate-limit` default in-memory store.
- Emails: sent in-process, errors logged; OTP send failures surface to the user.
- Domain events: Node `EventEmitter` in-process.
- Socket.IO: single backend instance, no adapter.
Consequence: backend must run as **one instance** until Redis is introduced.

> **Under review (B-017, 2026-11-20):** the backend `.env` implies Vercel hosting. Serverless functions cannot hold Socket.IO WebSocket connections and in-memory rate limiting is per instance, which conflicts with this ADR and NOTIF-01..03. Not decided; see `05-delivery/blockers.md`.
