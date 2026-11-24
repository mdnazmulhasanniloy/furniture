import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Prisma } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { AppError } from './errors.js';
import { createLogger, type Logger } from './logger.js';
import { prisma } from './prisma.js';
import { notSet } from './prismaFilters.js';

/**
 * Cloudflare R2 (ADR-010, T-008). Uploads go browser -> R2 with a presigned PUT; the server tracks them in the
 * `Upload` collection, verifies them with HeadObject when a save attaches them, and deletes them on removal.
 * Never log a presigned URL or a credential.
 */

export const ALLOWED_CONTENT_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;
export type AllowedContentType = keyof typeof ALLOWED_CONTENT_TYPES;
export const MAX_UPLOAD_BYTES = 5_242_880;
export const MAX_AVATAR_BYTES = 2_097_152;
export const PRESIGN_EXPIRES_IN = 300;

export type UploadScope = 'admin' | 'avatar';
type LogLike = Pick<Logger, 'error'>;
export interface R2Context {
  log?: LogLike;
  requestId?: string;
}

let fallbackLogger: Logger | undefined;
const logOf = (ctx: R2Context): LogLike => ctx.log ?? (fallbackLogger ??= createLogger(getEnv()));

const uploadNotAllowed = (message: string, details?: unknown) =>
  new AppError(422, 'UPLOAD_NOT_ALLOWED', message, details);

// ---------------------------------------------------------------- client

let client: S3Client | undefined;
function r2Config() {
  const e = getEnv();
  if (
    !e.R2_ACCESS_KEY_ID ||
    !e.R2_SECRET_ACCESS_KEY ||
    !e.R2_BUCKET_NAME ||
    !e.R2_ENDPOINT ||
    !e.R2_PUBLIC_BASE_URL
  ) {
    throw new Error('Cloudflare R2 is not configured (R2_* environment variables)');
  }
  return {
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET_NAME,
    endpoint: e.R2_ENDPOINT,
    publicBaseUrl: e.R2_PUBLIC_BASE_URL.replace(/\/+$/, ''),
  };
}

export function getS3(): S3Client {
  const c = r2Config();
  return (client ??= new S3Client({
    region: 'auto',
    endpoint: c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    // No automatic CRC32 query parameters: they would be signed into the URL and the browser PUT would fail.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }));
}

// ---------------------------------------------------------------- keys

export const keyPrefix = (): string => `furnixa/${getEnv().NODE_ENV}/`;
export const publicUrlFor = (key: string): string => `${r2Config().publicBaseUrl}/${key}`;

/** `furnixa/{env}/{yyyy}/{mm}/{uuid}.{ext}`; the client's file name is never used. */
export function newObjectKey(contentType: AllowedContentType, now = new Date()): string {
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${keyPrefix()}${yyyy}/${mm}/${randomUUID()}.${ALLOWED_CONTENT_TYPES[contentType]}`;
}

/** `furnixa/{env}/avatars/{userId}/{uuid}.{ext}` — customer avatar key (T-028). */
export function avatarObjectKey(userId: string, contentType: AllowedContentType): string {
  return `${keyPrefix()}avatars/${userId}/${randomUUID()}.${ALLOWED_CONTENT_TYPES[contentType]}`;
}

const KEY_CHARS = /^[A-Za-z0-9._/-]+$/;
const KEY_EXT = /\.(jpg|png|webp)$/;

/** True for a well-formed key inside `furnixa/{env}/` (no traversal, only jpg/png/webp). */
export function isValidKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    key.length <= 300 &&
    key.startsWith(keyPrefix()) &&
    KEY_CHARS.test(key) &&
    !key.includes('..') &&
    !key.includes('//') &&
    KEY_EXT.test(key)
  );
}

export interface ImageAsset {
  key: string;
  url: string;
  width?: number;
  height?: number;
  alt?: { en: string; ar: string };
}

/** The server always recomputes `url` from `key`; a key outside `furnixa/{env}/` is rejected (422). */
export function buildImageAsset(
  key: string,
  extra: Pick<ImageAsset, 'width' | 'height' | 'alt'> = {},
): ImageAsset {
  if (!isValidKey(key)) throw uploadNotAllowed('Invalid image key');
  const asset: ImageAsset = { key, url: publicUrlFor(key) };
  if (extra.width !== undefined) asset.width = extra.width;
  if (extra.height !== undefined) asset.height = extra.height;
  if (extra.alt !== undefined) asset.alt = extra.alt;
  return asset;
}

// ---------------------------------------------------------------- presign

export interface PresignInput {
  contentType: string;
  size: number;
}

/** 422 `UPLOAD_NOT_ALLOWED` unless jpeg/png/webp and within `maxBytes`. SVG and everything else is refused. */
export function assertUploadAllowed(
  input: PresignInput,
  maxBytes = MAX_UPLOAD_BYTES,
): AllowedContentType {
  if (!Object.hasOwn(ALLOWED_CONTENT_TYPES, input.contentType)) {
    throw uploadNotAllowed('Only JPEG, PNG and WebP images are allowed');
  }
  if (input.size > maxBytes) {
    throw uploadNotAllowed(`Image is larger than ${maxBytes} bytes`);
  }
  return input.contentType as AllowedContentType;
}

/** Signs a PUT that fixes Content-Type and Content-Length; records the `Upload` row (unattached). */
export async function createUploadPresign(opts: {
  contentType: AllowedContentType;
  size: number;
  uploadedById: string;
  scope: UploadScope;
  /** Override the default key generator (`newObjectKey`). Used by avatar presign. */
  keyFn?: (ct: AllowedContentType) => string;
}) {
  const c = r2Config();
  const key = opts.keyFn ? opts.keyFn(opts.contentType) : newObjectKey(opts.contentType);
  const uploadUrl = await getSignedUrl(
    getS3(),
    new PutObjectCommand({
      Bucket: c.bucket,
      Key: key,
      ContentType: opts.contentType,
      ContentLength: opts.size,
    }),
    { expiresIn: PRESIGN_EXPIRES_IN },
  );
  await prisma.upload.create({
    data: {
      key,
      uploadedById: opts.uploadedById,
      contentType: opts.contentType,
      size: opts.size,
      scope: opts.scope,
      attachedAt: null, // explicit null, so filters on `attachedAt: null` match (see UNATTACHED)
    },
  });
  return { uploadUrl, key, publicUrl: publicUrlFor(key), expiresIn: PRESIGN_EXPIRES_IN };
}

// ---------------------------------------------------------------- delete

/**
 * Deletes R2 objects by key. Never throws: a failure is logged (`key`, `requestId`; no URL, no credentials)
 * and reported in `failed`.
 */
export async function deleteObjects(
  keys: string[],
  ctx: R2Context = {},
): Promise<{ deleted: string[]; failed: string[] }> {
  const unique = [...new Set(keys)];
  const deleted: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    unique.map(async (key) => {
      try {
        await getS3().send(new DeleteObjectCommand({ Bucket: r2Config().bucket, Key: key }));
        deleted.push(key);
      } catch (err) {
        failed.push(key);
        logOf(ctx).error({ err, key, requestId: ctx.requestId }, 'R2 DeleteObject failed');
      }
    }),
  );
  return { deleted, failed };
}

// ---------------------------------------------------------------- server-side put / list (tooling)

/**
 * Server-side upload of an already validated image (used by the demo-data tooling; the API itself only presigns).
 * The caller owns validation of type and size; the key must be a valid key inside `furnixa/{env}/`.
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: AllowedContentType,
): Promise<void> {
  if (!isValidKey(key)) throw uploadNotAllowed('Invalid image key');
  await getS3().send(
    new PutObjectCommand({
      Bucket: r2Config().bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.byteLength,
    }),
  );
}

/** All object keys under `prefix` (follows pagination). */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res: {
      Contents?: { Key?: string }[];
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    } = await getS3().send(
      new ListObjectsV2Command({
        Bucket: r2Config().bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// ---------------------------------------------------------------- attach / release / sync

/** Null-or-missing (see prismaFilters.ts); rows are created with an explicit null, but be safe (T-028). */
export const UNATTACHED = notSet<Prisma.UploadWhereInput>('attachedAt');

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

export interface AttachOptions extends R2Context {
  scope: UploadScope;
  /** `avatar` uploads must belong to this user; `admin` uploads may be attached by any admin. */
  uploadedById: string;
  tx?: Prisma.TransactionClient;
}

/**
 * Attaches freshly uploaded keys to an entity. For each key: a tracked, unattached upload of the SAME scope
 * (avatar: also the same user), and `HeadObject` shows the object with the approved ContentType and size.
 * Anything else -> 422 `UPLOAD_NOT_ALLOWED` and nothing is attached. A HeadObject failure other than "not
 * found" is logged and surfaces as 500. The claim is atomic (all keys or none); pass `tx` to join the
 * caller's transaction (HeadObject runs before the claim, outside any database work).
 * Callers use `syncImages`, which only passes keys that are new on the entity.
 */
export async function attachUploads(keys: string[], opts: AttachOptions): Promise<void> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  for (const key of unique)
    if (!isValidKey(key)) throw uploadNotAllowed('Invalid image key', { key });

  const db = opts.tx ?? prisma;
  const rows = await db.upload.findMany({ where: { key: { in: unique } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const key of unique) {
    const row = byKey.get(key);
    const ok =
      row !== undefined &&
      row.scope === opts.scope &&
      row.attachedAt === null &&
      (opts.scope !== 'avatar' || row.uploadedById === opts.uploadedById);
    // One message for every reason: do not reveal whether another user's key exists.
    if (!ok) throw uploadNotAllowed('Upload not found or not allowed', { key });
  }

  const bucket = r2Config().bucket;
  await Promise.all(
    unique.map(async (key) => {
      const row = byKey.get(key)!;
      let head: { ContentType?: string; ContentLength?: number };
      try {
        head = await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        if (isNotFound(err)) throw uploadNotAllowed('Uploaded file not found', { key });
        logOf(opts).error({ err, key, requestId: opts.requestId }, 'R2 HeadObject failed');
        throw err;
      }
      if (head.ContentType !== row.contentType || head.ContentLength !== row.size) {
        throw uploadNotAllowed('Uploaded file does not match the approved type or size', { key });
      }
    }),
  );

  // Atomic claim: the conditional updateMany is the compare-and-swap that makes the loser of a
  // concurrent double-claim fail (its filter no longer matches, or the write conflicts).
  const claim = async (c: Prisma.TransactionClient) => {
    const res = await c.upload.updateMany({
      where: { AND: [{ key: { in: unique } }, UNATTACHED] },
      data: { attachedAt: new Date() },
    });
    if (res.count !== unique.length) throw uploadNotAllowed('Upload already attached');
  };
  if (opts.tx) await claim(opts.tx);
  else await prisma.$transaction(claim);
}

/**
 * Keys an order still shows (`Order.items.imageKey`, T-010/T-013): their R2 object must never be deleted.
 * On a query failure nothing is released (logged); the rows stay for a later retry.
 */
async function orderReferencedKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const orders = await prisma.order.findMany({
    where: { items: { some: { imageKey: { in: keys } } } },
    select: { items: true },
  });
  const wanted = new Set(keys);
  const referenced = new Set<string>();
  for (const order of orders)
    for (const item of order.items)
      if (item.imageKey && wanted.has(item.imageKey)) referenced.add(item.imageKey);
  return referenced;
}

/**
 * Deletes the R2 objects, then their `Upload` rows. Never throws. When an object cannot be deleted the row is
 * kept with `attachedAt` unset so the cron cleanup retries it. Keys without a row are still deleted from R2.
 * A key referenced by an order item's `imageKey` is only detached: its `Upload` row is removed but the R2
 * object is kept (the order still shows it; T-010, owner 2026-11-22).
 */
export async function releaseUploads(keys: string[], ctx: R2Context = {}): Promise<void> {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return;
  let referenced: Set<string>;
  try {
    referenced = await orderReferencedKeys(unique);
  } catch (err) {
    logOf(ctx).error({ err, requestId: ctx.requestId }, 'Order image-reference check failed');
    return; // release nothing: deleting could destroy an object an order still shows
  }
  const deletable = unique.filter((k) => !referenced.has(k));
  const { deleted, failed } = await deleteObjects(deletable, ctx);
  try {
    const detach = [...deleted, ...referenced];
    if (detach.length) await prisma.upload.deleteMany({ where: { key: { in: detach } } });
    if (failed.length) {
      await prisma.upload.updateMany({
        where: { key: { in: failed } },
        data: { attachedAt: null },
      });
    }
  } catch (err) {
    logOf(ctx).error({ err, requestId: ctx.requestId }, 'Upload row cleanup failed');
  }
}

export interface SyncResult {
  added: string[];
  removed: string[];
  /**
   * Call AFTER the caller's transaction has committed (never before: a rollback would leave rows that point at
   * deleted files). Deletes the removed objects and rows; never throws.
   */
  release: () => Promise<void>;
}

/**
 * The one entry point for saves (T-009, T-010, T-011, T-028). Compares the key sets: attaches only added keys
 * (inside `tx`), leaves unchanged keys and reorders alone (no HeadObject, no "already attached" error) and
 * hands back the removed keys to release after commit.
 */
export async function syncImages(
  tx: Prisma.TransactionClient,
  oldKeys: string[],
  newKeys: string[],
  scope: UploadScope,
  ctx: R2Context & { uploadedById: string },
): Promise<SyncResult> {
  const before = new Set(oldKeys);
  const after = new Set(newKeys);
  const added = [...after].filter((k) => !before.has(k));
  const removed = [...before].filter((k) => !after.has(k));
  await attachUploads(added, { ...ctx, scope, tx });
  return { added, removed, release: () => releaseUploads(removed, ctx) };
}
