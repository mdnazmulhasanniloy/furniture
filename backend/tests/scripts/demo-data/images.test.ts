import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertAllowedUrl,
  detectImageType,
  downloadImage,
  getImage,
  imageSize,
  ImageRejectedError,
  loadManifest,
  MAX_DEMO_IMAGE_BYTES,
  parseManifest,
  validateImage,
} from '../../../scripts/demo-data/images.js';

const OK_URL = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=100';

/** Smallest valid-looking files: only the header matters to the checks. */
const jpeg = (w = 640, h = 480) =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    0x01,
    0x01,
    0x00,
    0x00,
    0x01,
    0x00,
    0x01,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x03,
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
    0xff,
    0xd9,
  ]);
const png = (w = 800, h = 600) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const webpLossy = (w = 1024, h = 768) => {
  const b = new Uint8Array(40);
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  );
  b.set(
    [...'VP8 '].map((c) => c.charCodeAt(0)),
    12,
  );
  const dv = new DataView(b.buffer);
  dv.setUint16(26, w, true);
  dv.setUint16(28, h, true);
  return b;
};

const respond = (
  body: Uint8Array | string,
  init: { type?: string; status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(body as BodyInit, {
    status: init.status ?? 200,
    headers: { 'content-type': init.type ?? 'image/jpeg', ...init.headers },
  });

describe('T-078 · demo image host allowlist', () => {
  it('T-078 · accepts only https on images.pexels.com and images.unsplash.com', () => {
    expect(assertAllowedUrl(OK_URL).hostname).toBe('images.pexels.com');
    expect(assertAllowedUrl('https://images.unsplash.com/photo-1?w=10').hostname).toBe(
      'images.unsplash.com',
    );
  });

  it('T-078 · rejects other hosts, look-alikes, http, credentials, ports and garbage', () => {
    for (const bad of [
      'https://example.com/a.jpg',
      'https://evil.com/images.pexels.com/a.jpg',
      'https://images.pexels.com.evil.com/a.jpg',
      'https://pexels.com/a.jpg',
      'https://www.pexels.com/photo/x/',
      'http://images.pexels.com/a.jpg',
      'https://user:pw@images.pexels.com/a.jpg',
      'https://images.pexels.com:8443/a.jpg',
      'ftp://images.pexels.com/a.jpg',
      'not a url',
    ]) {
      expect(() => assertAllowedUrl(bad), bad).toThrow(ImageRejectedError);
    }
  });

  it('T-078 · a redirect to a host outside the allowlist is rejected and never followed', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.startsWith('https://images.pexels.com')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example.net/x.jpg' },
          })
        : respond(jpeg()),
    );
    await expect(downloadImage(OK_URL, fetchImpl)).rejects.toThrow(/Host not allowed/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('T-078 · a redirect to http is rejected', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: { location: 'http://images.pexels.com/x.jpg' },
        }),
    );
    await expect(downloadImage(OK_URL, fetchImpl)).rejects.toThrow(/https/);
  });

  it('T-078 · a redirect inside the allowlist is followed, a redirect loop is cut off', async () => {
    const hop = vi.fn(async (url: string) =>
      url.includes('/a.jpg')
        ? new Response(null, {
            status: 302,
            headers: { location: 'https://images.unsplash.com/b.jpg' },
          })
        : respond(jpeg()),
    );
    expect((await downloadImage('https://images.pexels.com/a.jpg', hop)).contentType).toBe(
      'image/jpeg',
    );
    const loop = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://images.pexels.com/a.jpg' },
        }),
    );
    await expect(downloadImage('https://images.pexels.com/a.jpg', loop)).rejects.toThrow(
      /redirects/,
    );
  });
});

describe('T-078 · demo image content checks', () => {
  it('T-078 · a non-image served with an image content-type fails the magic-byte check', async () => {
    const html = new TextEncoder().encode('<html><body>not an image</body></html>');
    await expect(downloadImage(OK_URL, async () => respond(html))).rejects.toThrow(/Magic bytes/);
    expect(() =>
      validateImage(new TextEncoder().encode('GIF89a-not-allowed'), 'image/jpeg'),
    ).toThrow(ImageRejectedError);
  });

  it('T-078 · the magic bytes must match the declared type', () => {
    expect(() => validateImage(png(), 'image/jpeg')).toThrow(/content-type says/);
    expect(() => validateImage(jpeg(), 'image/png')).toThrow(/content-type says/);
    expect(() => validateImage(webpLossy(), 'image/png')).toThrow(ImageRejectedError);
  });

  it('T-078 · rejects SVG, GIF, HTML and missing content types', () => {
    for (const type of [
      'image/svg+xml',
      'image/gif',
      'text/html',
      'application/octet-stream',
      '',
    ]) {
      expect(() => validateImage(jpeg(), type), type).toThrow(/Content-type not allowed/);
    }
    expect(() => validateImage(jpeg(), null)).toThrow(ImageRejectedError);
  });

  it('T-078 · rejects an empty body and anything over 4 MB (declared or streamed)', async () => {
    expect(() => validateImage(new Uint8Array(0), 'image/jpeg')).toThrow(/Empty/);
    const big = new Uint8Array(MAX_DEMO_IMAGE_BYTES + 1);
    big.set(jpeg());
    expect(() => validateImage(big, 'image/jpeg')).toThrow(/larger than/);
    await expect(
      downloadImage(OK_URL, async () =>
        respond(jpeg(), { headers: { 'content-length': String(MAX_DEMO_IMAGE_BYTES + 1) } }),
      ),
    ).rejects.toThrow(/larger than/);
    await expect(downloadImage(OK_URL, async () => respond(big))).rejects.toThrow(/larger than/);
  });

  it('T-078 · a non-200 response is rejected', async () => {
    await expect(
      downloadImage(OK_URL, async () => respond('nope', { status: 404, type: 'text/plain' })),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('T-078 · valid JPEG, PNG and WebP pass and their dimensions are read from the header', () => {
    expect(validateImage(jpeg(640, 480), 'image/jpeg; charset=binary')).toMatchObject({
      contentType: 'image/jpeg',
      width: 640,
      height: 480,
    });
    expect(validateImage(png(800, 600), 'image/png')).toMatchObject({
      contentType: 'image/png',
      width: 800,
      height: 600,
    });
    expect(validateImage(webpLossy(1024, 768), 'image/webp')).toMatchObject({
      contentType: 'image/webp',
      width: 1024,
      height: 768,
    });
    expect(detectImageType(jpeg())).toBe('image/jpeg');
    expect(imageSize(png(5, 7), 'image/png')).toEqual({ width: 5, height: 7 });
  });
});

describe('T-078 · demo image cache and manifest', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = '';
  });

  it('T-078 · a downloaded image is cached: the second call does not hit the network', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'demo-cache-'));
    const fetchImpl = vi.fn(async () => respond(jpeg(10, 20)));
    const a = await getImage(OK_URL, dir, fetchImpl);
    const b = await getImage(OK_URL, dir, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(b).toMatchObject({ contentType: 'image/jpeg', width: 10, height: 20 });
    expect(a.bytes).toEqual(b.bytes);
  });

  it('T-078 · a disallowed URL never reaches fetch, even when a cache exists', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'demo-cache-'));
    const fetchImpl = vi.fn();
    await expect(getImage('https://example.com/a.jpg', dir, fetchImpl)).rejects.toThrow(
      ImageRejectedError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('T-078 · images.json lists a source page, photographer and licence for every image, on allowed hosts', async () => {
    const manifest = await loadManifest(path.resolve('scripts/demo-data/images.json'));
    expect(manifest.length).toBeGreaterThanOrEqual(45);
    for (const m of manifest) {
      expect(m.photographer.trim().length, m.id).toBeGreaterThan(0);
      expect(['Pexels License', 'Unsplash License']).toContain(m.licence);
      expect(new URL(m.pageUrl).protocol).toBe('https:');
      expect(() => assertAllowedUrl(m.imageUrl), m.id).not.toThrow();
      expect(m.description.en && m.description.ar, m.id).toBeTruthy();
    }
    expect(new Set(manifest.map((m) => m.imageUrl)).size).toBe(manifest.length);
  });

  it('T-078 · parseManifest rejects an entry without a photographer, a licence or an allowed image host', () => {
    const base = {
      id: 'x',
      theme: 't',
      pageUrl: 'https://www.pexels.com/photo/x-1/',
      photographer: 'A B',
      licence: 'Pexels License',
      imageUrl: OK_URL,
      orientation: 'landscape',
      description: { en: 'a', ar: 'ب' },
    };
    expect(parseManifest({ images: [base] })).toHaveLength(1);
    expect(() => parseManifest({ images: [{ ...base, photographer: ' ' }] })).toThrow(
      /photographer/,
    );
    expect(() => parseManifest({ images: [{ ...base, licence: 'CC-BY' }] })).toThrow(/licence/);
    expect(() =>
      parseManifest({ images: [{ ...base, imageUrl: 'https://example.com/a.jpg' }] }),
    ).toThrow(ImageRejectedError);
    expect(() =>
      parseManifest({ images: [{ ...base, pageUrl: 'https://example.com/p' }] }),
    ).toThrow(/source page/);
    expect(() => parseManifest({ images: [base, base] })).toThrow(/duplicate/);
  });
});
