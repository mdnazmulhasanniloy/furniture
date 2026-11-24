import { createHash, timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";

// T-045 / B-028 (owner decisions, CR-011 Q-9): the storefront's on-demand revalidation webhook.
// - POST only; every other method is 405.
// - The secret comes in the `x-revalidate-secret` header and is compared with timingSafeEqual over SHA-256
//   digests (equal lengths, constant time). A missing, wrong or UNSET secret is 401 with no body: the route
//   fails closed and tells a caller nothing.
// - The body must be `{ tags: string[] }` and every tag must be on the allow-list, or the whole request is 400.
// - Rate limited per client (see below). The secret and the request are never logged.
//
// The limiter is in memory: on a serverless host it is per instance, so it slows a guessing attack down but is
// not a global cap; a long random secret and the constant-time compare are the real protection.

const TAG = /^(?:home|products|settings|product:[a-z0-9-]{1,100}|page:[a-z0-9-]{1,100})$/;
const MAX_TAGS = 20;
const MAX_BODY = 4096;

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60; // any request, per client per minute
const MAX_FAILURES = 10; // wrong or missing secret, per client per minute
type Bucket = { start: number; requests: number; failures: number };
const buckets = new Map<string, Bucket>();

/** Test hook: forget every client. */
export function resetRevalidateLimiter() {
  buckets.clear();
}

function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}

function bucketFor(key: string, now: number): Bucket {
  let b = buckets.get(key);
  if (!b || now - b.start >= WINDOW_MS) {
    b = { start: now, requests: 0, failures: 0 };
    buckets.set(key, b);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start >= WINDOW_MS) buckets.delete(k);
  }
  return b;
}

const digest = (v: string) => createHash("sha256").update(v).digest();

function secretMatches(provided: string | null): boolean {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected || !provided) return false; // unset secret: fail closed
  return timingSafeEqual(digest(provided), digest(expected));
}

const empty = (status: number, headers?: HeadersInit) => new Response(null, { status, headers });

export async function handleRevalidate(req: Request, now = Date.now()): Promise<Response> {
  const bucket = bucketFor(clientKey(req), now);
  bucket.requests += 1;
  if (bucket.requests > MAX_REQUESTS || bucket.failures >= MAX_FAILURES) {
    const retry = Math.max(1, Math.ceil((bucket.start + WINDOW_MS - now) / 1000));
    return empty(429, { "Retry-After": String(retry) });
  }

  if (!secretMatches(req.headers.get("x-revalidate-secret"))) {
    bucket.failures += 1;
    return empty(401);
  }

  let tags: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY) return empty(400);
    tags = (JSON.parse(text) as { tags?: unknown } | null)?.tags;
  } catch {
    return empty(400);
  }
  if (
    !Array.isArray(tags) ||
    tags.length < 1 ||
    tags.length > MAX_TAGS ||
    !tags.every((t) => typeof t === "string" && TAG.test(t))
  ) {
    return empty(400);
  }

  const unique = [...new Set(tags as string[])];
  // Expire now (not stale-while-revalidate): an admin edit must show on the next request.
  for (const tag of unique) revalidateTag(tag, { expire: 0 });
  return Response.json({ revalidated: unique });
}

export const methodNotAllowed = () => empty(405, { Allow: "POST" });
