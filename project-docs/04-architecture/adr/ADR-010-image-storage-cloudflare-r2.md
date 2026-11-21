# ADR-010: Cloudflare R2 for image storage (presigned direct uploads)

Status: **Accepted 2026-11-20** (team/client decision, SRC-006.1) · **Supersedes ADR-007 (Cloudinary)** · re-resolves B-004

## Decision
- Storage is **Cloudflare R2**, accessed through its S3-compatible API with `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. Cloudinary and `multer` are no longer used.
- **Uploads go directly from the admin browser to R2** with a presigned `PUT` URL. The backend never receives the file bytes.
- `POST /admin/uploads/presign` (admin only), body `{ fileName, contentType, size }`, returns `{ uploadUrl, key, publicUrl, expiresIn }`.
  - `contentType` must be `image/jpeg`, `image/png` or `image/webp`; `size` ≤ 5 MB (5 242 880 bytes). Otherwise 422.
  - The presigned URL signs `ContentType` and `ContentLength`, so R2 rejects an upload that differs from what was approved. It expires after 300 s (`expiresIn: 300`).
  - Key format: `furnixa/{env}/{yyyy}/{mm}/{uuid}.{ext}` where `env` = `NODE_ENV`, `uuid` = `crypto.randomUUID()`, `ext` = `jpg` | `png` | `webp` derived from `contentType` (the client's `fileName` is never used in the key).
- `ImageAsset = { key, url, width?, height?, alt? }`. `publicId` is removed. `url = R2_PUBLIC_BASE_URL + "/" + key`; the server always recomputes `url` from `key` on save and rejects a `key` that does not start with `furnixa/{env}/`.
- `width`/`height` are optional and supplied by the admin client (read from the file before upload).
- **Deletion:** when an image is removed from a product or banner, or a product is deleted, the backend deletes the object from R2 (`DeleteObject` by `key`). A failed delete is logged (pino, with `key` and `requestId`) and never fails the request. The same rule applies wherever an `ImageAsset` is replaced (category image, site logo) — flagged assumption.
- Env keys: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_PUBLIC_BASE_URL`.
- The bucket needs a CORS rule allowing `PUT` from the admin origin (`integrations.md#cloudflare-r2`).
- Next.js `images.remotePatterns` allows the host of `R2_PUBLIC_BASE_URL`; resizing/format is done by Next.js image optimisation (no provider transformations).
- Tests mock the S3 client (no network, no real bucket).

## Alternatives
- Cloudinary (ADR-007): built-in transformations, but egress/storage limits and a second vendor; replaced.
- Proxy upload through the API: simpler CORS, but file bytes pass through the backend (and any serverless body limit); avoided.
- Local disk: dev only.

## Consequences
- Objects are public-read through `R2_PUBLIC_BASE_URL`; there are no private images.
- Orphans (a browser uploads and the form is never saved) are tracked by the `Upload` collection and removed by the ADR-012 cron cleanup after 24 h (amended 2026-11-21, T-008): presign records the upload, saves attach it after a `HeadObject` check, removals release it. The presign route is limited to 30 per admin per 10 minutes. The public domain must send `X-Content-Type-Options: nosniff`; SVG is never allowed.
- `package.json` must drop `cloudinary` and `multer` and add the two AWS SDK packages (T-008).
