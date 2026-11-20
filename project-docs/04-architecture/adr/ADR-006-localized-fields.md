# ADR-006: Localized content as embedded { en, ar } composite types

Status: Accepted · Source: SRC-001.13, amended by SRC-003.4 (default locale `ar`)

Translatable fields are Prisma composite type `LocalizedText { en ar }`. The API returns both languages; clients pick by active locale with fallback to the default locale `ar`.

**Amendment 2026-11-20:** `ar` is the default locale, so `ar` is the required language when saving content and `en` is required before publishing. Admin editors show the Arabic tab first. UI strings (buttons, labels) live in front-end message files (`messages/en.json`, `messages/ar.json`), not the DB.
