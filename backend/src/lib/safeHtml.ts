import sanitize from 'sanitize-html';
import { getEnv } from '../config/env.js';

/**
 * Link safety (owner 2026-11-22, T-011): a same-site path ("/" followed by anything but "/" or "\",
 * which browsers would treat as protocol-relative) or an absolute https:// URL. Everything else —
 * javascript:, data:, http:, "//host", "/\host" — is rejected. Used by banner `ctaHref` and page links.
 */
export function isSafeHref(href: string): boolean {
  // Browsers drop tab/newline inside URLs ("/<TAB>/host" becomes "//host"): reject control chars anywhere.
  // eslint-disable-next-line no-control-regex -- control chars are exactly what is rejected here
  if (/[\u0000-\u001f\u007f]/.test(href)) return false;
  if (/^\/(?![/\\])/.test(href)) return true;
  return /^https:\/\//i.test(href);
}

/** Matches what the Tiptap editor produces (ADR-013). */
const ALLOWED_TAGS = [
  'p',
  'h2',
  'h3',
  'h4',
  'strong',
  'em',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'blockquote',
  'br',
  'hr',
  'img',
];

/**
 * Sanitises admin-authored page HTML on write (ADR-013, defense in depth even though admins are
 * trusted). Allowlist only: script/iframe/style/on* never survive; `img` only with a `src` under
 * `R2_PUBLIC_BASE_URL`; `a` only with a safe href (external https links get rel="noopener noreferrer",
 * an unsafe href is dropped and the link text kept).
 */
export function sanitizePageHtml(html: string): string {
  const base = getEnv().R2_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  return sanitize(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'rel'], img: ['src', 'alt'] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    // An img whose src is not under the R2 public base (or with no src left) is removed entirely.
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !(base && frame.attribs.src?.startsWith(`${base}/`)),
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        const next: Record<string, string> = {};
        if (href && isSafeHref(href)) {
          next.href = href;
          if (/^https:\/\//i.test(href)) next.rel = 'noopener noreferrer';
        }
        return { tagName, attribs: next };
      },
    },
  });
}
