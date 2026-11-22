# ADR-013: Static-page HTML is sanitised on write

Status: Accepted (owner 2026-11-22, T-011) · Source: ADM-08, NFR-01

Static pages (ADM-08) store admin-authored rich text as HTML in `Page.content.{en,ar}`. Although admins are
trusted (T-008), the backend sanitises the HTML on **every write** as defense in depth: a compromised admin
account or a copy-pasted payload must not be able to store script that the storefront would then serve to every
visitor.

**Decision.** `POST /admin/pages` and `PATCH /admin/pages/{id}` run `content.en` and `content.ar` through
[`sanitize-html`](https://www.npmjs.com/package/sanitize-html) with an allowlist matching what the Tiptap editor
produces:

- **Tags:** `p, h2, h3, h4, strong, em, u, s, ul, ol, li, a, blockquote, br, hr`, and `img` only when its `src`
  is under `R2_PUBLIC_BASE_URL` (any other `img` is removed entirely).
- **Links:** `href` must be `https:` or a same-site path (same rule as banner `ctaHref`: `/` not followed by
  `/` or `\`); external (https) links get `rel="noopener noreferrer"`; a link with a disallowed href loses the
  href.
- **Stripped always:** `script`, `iframe`, `style` attributes, all `on*` handlers, `javascript:`/`data:` URLs,
  protocol-relative URLs, and every tag or attribute not allowlisted.

Sanitisation happens in the service before the transaction, so the stored document and every response are
already clean; the storefront can render `content` without further processing. Allowed attributes: `a[href,
rel]`, `img[src, alt]`.

**Consequences.** Formatting outside the allowlist (tables, embeds, custom classes) is silently dropped — the
admin editor must stick to the allowlisted marks. Widening the allowlist is a one-line change here plus a spec
note, and needs a new owner decision.
