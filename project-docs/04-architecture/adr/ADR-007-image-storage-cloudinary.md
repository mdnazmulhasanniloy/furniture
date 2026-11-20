# ADR-007: Cloudinary for image storage

Status: **Superseded by ADR-010 (Cloudflare R2), 2026-11-20.** Originally accepted 2026-11-20 (client approved, SRC-002.3, B-004). Kept for history; do not implement.

## Decision
- All images (products, categories, banners, logo, avatars) are uploaded through the backend `POST /admin/uploads` (multer memory storage → Cloudinary upload stream). Browsers never hold Cloudinary credentials.
- Folders: `furnixa/{env}/{products|categories|banners|settings}`.
- We store `ImageAsset { url, publicId, alt?, width?, height? }`. When an image is removed or replaced, the backend deletes it by `publicId`.
- Delivery uses Cloudinary transformations (`f_auto,q_auto`, sized per use). The Next.js app allows `res.cloudinary.com` in `images.remotePatterns`.
- Credentials come from `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (already in `.env.example`).

## Alternatives
- Local disk: simple, but lost on redeploy and no CDN. **Dev only**, with no production fallback.
- S3-compatible storage: more setup (CDN, resizing) for no MVP benefit.

## Consequences
Free-tier limits apply (storage/bandwidth); revisit if the catalogue grows. Source: `integrations.md#cloudinary`.
