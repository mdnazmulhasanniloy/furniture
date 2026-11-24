import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Image pipeline of the demo-data tooling: host allowlist, content-type + size + magic-byte validation,
 * a download cache and header-based width/height (no image library is a dependency).
 */

export const ALLOWED_IMAGE_HOSTS = ['images.pexels.com', 'images.unsplash.com'] as const;
export const MAX_DEMO_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 20_000;

export type DemoImageType = 'image/jpeg' | 'image/png' | 'image/webp';
const TYPES: readonly DemoImageType[] = ['image/jpeg', 'image/png', 'image/webp'];

export class ImageRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageRejectedError';
  }
}
const reject = (m: string) => new ImageRejectedError(m);

/** https only, host exactly one of the allowed hosts, no credentials, no explicit port. */
export function assertAllowedUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw reject(`Not a valid URL: ${raw}`);
  }
  if (u.protocol !== 'https:') throw reject(`Only https is allowed: ${u.protocol}//${u.host}`);
  if (u.username || u.password) throw reject('URLs with credentials are not allowed');
  if (u.port) throw reject('URLs with an explicit port are not allowed');
  if (!(ALLOWED_IMAGE_HOSTS as readonly string[]).includes(u.hostname)) {
    throw reject(`Host not allowed: ${u.hostname}`);
  }
  return u;
}

/** Image type from the magic bytes; null when the bytes are not a JPEG, PNG or WebP. */
export function detectImageType(b: Uint8Array): DemoImageType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)
  ) {
    return 'image/png';
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Width and height from the file header; null when the header cannot be parsed. */
export function imageSize(
  b: Uint8Array,
  type: DemoImageType,
): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (type === 'image/png') {
    if (b.length < 24) return null;
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (type === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = b[i + 1]!;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = dv.getUint16(i + 2);
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  // WebP: VP8 (lossy), VP8L (lossless), VP8X (extended)
  if (b.length < 30) return null;
  const fourcc = String.fromCharCode(...b.subarray(12, 16));
  if (fourcc === 'VP8X') {
    const w = 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16));
    const h = 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16));
    return { width: w, height: h };
  }
  if (fourcc === 'VP8 ') {
    return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
  }
  if (fourcc === 'VP8L') {
    const bits = dv.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export interface ValidatedImage {
  bytes: Uint8Array;
  contentType: DemoImageType;
  width: number;
  height: number;
}

/** Declared content-type, size and magic bytes must all agree; throws `ImageRejectedError` otherwise. */
export function validateImage(
  bytes: Uint8Array,
  declaredContentType: string | null,
): ValidatedImage {
  const declared = (declaredContentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!(TYPES as readonly string[]).includes(declared)) {
    throw reject(`Content-type not allowed: ${declared || '(none)'}`);
  }
  if (bytes.byteLength === 0) throw reject('Empty body');
  if (bytes.byteLength > MAX_DEMO_IMAGE_BYTES) {
    throw reject(`Image larger than ${MAX_DEMO_IMAGE_BYTES} bytes`);
  }
  const actual = detectImageType(bytes);
  if (actual === null) throw reject('Magic bytes are not a JPEG, PNG or WebP image');
  if (actual !== declared) {
    throw reject(`Magic bytes say ${actual} but content-type says ${declared}`);
  }
  const size = imageSize(bytes, actual);
  if (!size || size.width < 1 || size.height < 1)
    throw reject('Image dimensions could not be read');
  return { bytes, contentType: actual, ...size };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function readCapped(res: Response): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') ?? '0');
  if (declared > MAX_DEMO_IMAGE_BYTES) {
    throw reject(`Image larger than ${MAX_DEMO_IMAGE_BYTES} bytes`);
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(await res.arrayBuffer());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DEMO_IMAGE_BYTES) {
      await reader.cancel();
      throw reject(`Image larger than ${MAX_DEMO_IMAGE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/** GET with manual redirects: every hop is checked against the allowlist again. */
export async function downloadImage(
  rawUrl: string,
  fetchImpl: FetchLike = fetch,
): Promise<ValidatedImage> {
  let url = assertAllowedUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: 'image/jpeg,image/png,image/webp' },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw reject('Redirect without a location');
      url = assertAllowedUrl(new URL(loc, url).toString());
      continue;
    }
    if (!res.ok) throw reject(`Download failed with HTTP ${res.status}`);
    return validateImage(await readCapped(res), res.headers.get('content-type'));
  }
  throw reject('Too many redirects');
}

/** Cached download: keyed by the URL hash; a cached file is re-validated on every read. */
export async function getImage(
  rawUrl: string,
  cacheDir: string,
  fetchImpl: FetchLike = fetch,
): Promise<ValidatedImage> {
  assertAllowedUrl(rawUrl);
  const name = createHash('sha256').update(rawUrl).digest('hex').slice(0, 32);
  const file = path.join(cacheDir, `${name}.bin`);
  const meta = path.join(cacheDir, `${name}.type`);
  try {
    const [bytes, type] = await Promise.all([readFile(file), readFile(meta, 'utf8')]);
    return validateImage(new Uint8Array(bytes), type.trim());
  } catch {
    // missing or invalid cache entry: download again
  }
  const img = await downloadImage(rawUrl, fetchImpl);
  await mkdir(cacheDir, { recursive: true });
  await Promise.all([writeFile(file, img.bytes), writeFile(meta, img.contentType)]);
  return img;
}

// ---------------------------------------------------------------- manifest

export interface ManifestImage {
  id: string;
  theme: string;
  pageUrl: string;
  photographer: string;
  licence: 'Pexels License' | 'Unsplash License';
  imageUrl: string;
  orientation: 'landscape' | 'portrait' | 'square';
  description: { en: string; ar: string };
}

/** Throws unless every entry has a source page, a photographer, a licence and an allowed image URL. */
export function parseManifest(json: unknown): ManifestImage[] {
  const list = (json as { images?: unknown })?.images;
  if (!Array.isArray(list) || list.length === 0) throw new Error('images.json has no images');
  const ids = new Set<string>();
  for (const raw of list as Partial<ManifestImage>[]) {
    const where = raw.id ?? '(no id)';
    if (!raw.id || ids.has(raw.id))
      throw new Error(`images.json: missing or duplicate id ${where}`);
    ids.add(raw.id);
    if (!raw.photographer?.trim()) throw new Error(`images.json: ${where} has no photographer`);
    if (raw.licence !== 'Pexels License' && raw.licence !== 'Unsplash License') {
      throw new Error(`images.json: ${where} has no valid licence`);
    }
    const page = new URL(raw.pageUrl ?? 'invalid:');
    const pageHost = page.hostname.replace(/^www\./, '');
    if (page.protocol !== 'https:' || !['pexels.com', 'unsplash.com'].includes(pageHost)) {
      throw new Error(`images.json: ${where} source page must be an https pexels/unsplash page`);
    }
    assertAllowedUrl(raw.imageUrl ?? '');
  }
  return list as ManifestImage[];
}

export async function loadManifest(file: string): Promise<ManifestImage[]> {
  return parseManifest(JSON.parse(await readFile(file, 'utf8')));
}
