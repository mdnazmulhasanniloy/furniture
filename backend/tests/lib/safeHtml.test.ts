import { describe, expect, it } from 'vitest';
import sanitize from 'sanitize-html';
import { isSafeHref, sanitizePageHtml } from '../../src/lib/safeHtml.js';

/**
 * T-029 regression tests for the sanitize-html <2.18.0 advisories (GHSA batch fixed in 2.18.0):
 * `javascript:` URIs passed scheme filtering through the `action`, `formaction`, `data`, `poster`
 * and `background` attributes, plus the SVG SMIL (`<animate>`) href bypass, and `data:` URIs in the
 * same spots. These tests pin the fixed behaviour so a downgrade or config change fails loudly.
 */
describe('NFR-01 · sanitize-html ≥2.18.0 advisory regressions (T-029, ADR-013)', () => {
  describe('through sanitizePageHtml (ADR-013 page config)', () => {
    const vectors: Record<string, string> = {
      'form action': '<form action="javascript:alert(1)"><p>keep</p></form>',
      'button formaction': '<p>keep</p><button formaction="javascript:alert(2)">go</button>',
      'object data javascript:': '<p>keep</p><object data="javascript:alert(3)"></object>',
      'object data data-URI':
        '<p>keep</p><object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
      'video poster': '<p>keep</p><video poster="javascript:alert(4)"></video>',
      'table background':
        '<table background="javascript:alert(5)"><tr><td>cell</td></tr></table><p>keep</p>',
      'svg SMIL animate':
        '<p>keep</p><svg><a><animate attributeName="href" values="javascript:alert(6)"></animate>x</a></svg>',
      'a href data-URI': '<p>keep</p><a href="data:text/html,<script>alert(7)</script>">x</a>',
      'img src data-URI': '<p>keep</p><img src="data:image/svg+xml,<svg onload=alert(8)>">',
    };

    for (const [name, payload] of Object.entries(vectors)) {
      it(`NFR-01 · ${name} vector stores no javascript: or data: URI`, () => {
        const out = sanitizePageHtml(payload);
        expect(out).not.toContain('javascript:');
        expect(out).not.toContain('data:');
        expect(out).toContain('keep');
        for (const attr of ['action', 'formaction', 'poster', 'background', 'onload']) {
          expect(out).not.toContain(`${attr}=`);
        }
      });
    }
  });

  describe('library level — scheme filtering covers the advisory attributes even when allowlisted', () => {
    // Deliberately allows the vulnerable tags/attributes: before 2.18.0, sanitize-html applied
    // allowedSchemes only to href/src-style attributes, so javascript: survived in these.
    const opts: sanitize.IOptions = {
      allowedTags: ['form', 'button', 'object', 'video', 'table', 'a'],
      allowedAttributes: {
        form: ['action'],
        button: ['formaction'],
        object: ['data'],
        video: ['poster'],
        table: ['background'],
        a: ['href'],
      },
      allowedSchemes: ['https'],
      allowProtocolRelative: false,
    };

    it.each([
      ['action', '<form action="javascript:alert(1)">x</form>'],
      ['formaction', '<button formaction="javascript:alert(2)">x</button>'],
      ['data', '<object data="javascript:alert(3)"></object>'],
      ['poster', '<video poster="javascript:alert(4)"></video>'],
      ['background', '<table background="javascript:alert(5)"></table>'],
    ])('NFR-01 · javascript: URI in %s is removed', (attr, payload) => {
      const out = sanitize(payload, opts);
      expect(out).not.toContain('javascript:');
      expect(out).not.toContain(`${attr}=`);
    });

    it.each([
      ['data', '<object data="data:text/html;base64,PHNjcmlwdD4="></object>'],
      ['href', '<a href="data:text/html,alert(6)">x</a>'],
    ])('NFR-01 · data: URI in %s is removed', (attr, payload) => {
      const out = sanitize(payload, opts);
      expect(out).not.toContain('data:');
      expect(out).not.toContain(`${attr}=`);
    });

    it('NFR-01 · https URIs in the same attributes survive (fix filters schemes, not attributes)', () => {
      expect(sanitize('<form action="https://ok.example/submit">x</form>', opts)).toContain(
        'action="https://ok.example/submit"',
      );
      expect(sanitize('<video poster="https://ok.example/p.jpg"></video>', opts)).toContain(
        'poster="https://ok.example/p.jpg"',
      );
    });

    it('NFR-01 · installed sanitize-html is at least 2.18.0 (advisory fix floor)', async () => {
      const { default: pkg } = await import('sanitize-html/package.json', {
        with: { type: 'json' },
      });
      const [major = 0, minor = 0] = (pkg as { version: string }).version.split('.').map(Number);
      expect(major > 2 || (major === 2 && minor >= 18)).toBe(true);
    });
  });
});

describe('ADM-06 · isSafeHref rejects control-character protocol-relative tricks', () => {
  it.each(['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'http://x.com'])(
    'rejects %j',
    (v) => expect(isSafeHref(v)).toBe(false),
  );
  it('keeps same-site paths and https URLs', () => {
    expect(isSafeHref('/shop?type=new')).toBe(true);
    expect(isSafeHref('https://example.com/x')).toBe(true);
  });
});
