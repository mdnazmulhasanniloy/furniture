import { MongoClient, type Collection, type Document } from 'mongodb';
import { getEnv } from '../config/env.js';

/**
 * Native MongoDB driver client for the Socket.IO adapter and emitter (ADR-012, T-023).
 * One client per instance via a globalThis singleton (like `prisma.ts`), `maxPoolSize` 2, on the same
 * `DATABASE_URL` as Prisma. The driver connects lazily on first operation; nothing dials at import time.
 */

const g = globalThis as unknown as { __furnixaMongo?: MongoClient };

export function getMongoClient(): MongoClient {
  return (g.__furnixaMongo ??= new MongoClient(getEnv().DATABASE_URL, { maxPoolSize: 2 }));
}

/** The Socket.IO adapter/emitter collection (`SOCKET_ADAPTER_COLLECTION`) in the `DATABASE_URL` database. */
export function adapterCollection(): Collection<Document> {
  return getMongoClient().db().collection(getEnv().SOCKET_ADAPTER_COLLECTION);
}

const TTL_INDEX = 'createdAt_ttl';

let indexesReady: Promise<void> | undefined;

/**
 * TTL index on the adapter collection: `{createdAt: 1}, expireAfterSeconds: SOCKET_ADAPTER_TTL_SECONDS`
 * (a TTL collection, not capped, so the T-025 cron can also delete from it — ADR-012). Idempotent and
 * memoized; a failure is retried on the next call. If the TTL value changed since the index was created,
 * MongoDB answers IndexOptionsConflict (code 85) and the index is updated in place with `collMod`.
 */
export function ensureSocketIndexes(): Promise<void> {
  indexesReady ??= createTtlIndex().catch((err: unknown) => {
    indexesReady = undefined;
    throw err;
  });
  return indexesReady;
}

async function createTtlIndex(): Promise<void> {
  const env = getEnv();
  const db = getMongoClient().db();
  try {
    await db.command({
      createIndexes: env.SOCKET_ADAPTER_COLLECTION,
      indexes: [
        {
          key: { createdAt: 1 },
          name: TTL_INDEX,
          expireAfterSeconds: env.SOCKET_ADAPTER_TTL_SECONDS,
        },
      ],
    });
  } catch (err) {
    if ((err as { code?: number }).code !== 85) throw err; // 85 = IndexOptionsConflict: TTL value changed
    await db.command({
      collMod: env.SOCKET_ADAPTER_COLLECTION,
      index: { name: TTL_INDEX, expireAfterSeconds: env.SOCKET_ADAPTER_TTL_SECONDS },
    });
  }
}

/** Test hook: forget the memoized index promise. */
export function resetSocketIndexMemo(): void {
  indexesReady = undefined;
}

/** Tests and graceful shutdown: close the singleton (a later call to `getMongoClient` makes a fresh one). */
export async function closeMongoClient(): Promise<void> {
  const client = g.__furnixaMongo;
  g.__furnixaMongo = undefined;
  indexesReady = undefined;
  await client?.close();
}
