/**
 * Data migration for T-005 (ADR-001: no schema change without a migration script).
 *
 * `RefreshToken.familyId` became a required field. Rows written before T-005 have none, and Prisma cannot
 * read them. They are dev-only data (nothing was deployed), so they are deleted: every affected user simply
 * logs in again.
 *
 *   npm run migrate:refresh-family                       prints how many rows lack familyId, deletes nothing
 *   npm run migrate:refresh-family -- --confirm          deletes the rows without familyId
 *   npm run migrate:refresh-family -- --all              prints how many refresh tokens exist, deletes nothing
 *   npm run migrate:refresh-family -- --all --confirm    deletes EVERY refresh token (all sessions end)
 *
 * `--all` exists because before T-005 dev request logs contained live refresh tokens and JWTs, so every dev
 * session should be ended. It is refused when NODE_ENV=production.
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';

const COLLECTION = 'RefreshToken'; // no @@map on the model
/** `familyId: null` matches both a null value and a missing field in MongoDB. */
const WITHOUT_FAMILY = { familyId: null };
const EVERYTHING = {};

type Db = Pick<PrismaClient, '$runCommandRaw'>;

export interface MigrationResult {
  found: number;
  deleted: number;
}

export async function run(
  argv: string[],
  db: Db,
  log: (message: string) => void = console.log,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): Promise<MigrationResult> {
  const all = argv.includes('--all');
  if (all && nodeEnv === 'production') {
    throw new Error('--all is refused when NODE_ENV=production');
  }
  const query = all ? EVERYTHING : WITHOUT_FAMILY;
  const what = all ? 'RefreshToken rows' : 'RefreshToken rows without familyId';

  const counted = (await db.$runCommandRaw({ count: COLLECTION, query })) as { n?: number };
  const found = counted.n ?? 0;
  log(`${what}: ${found}`);

  if (found === 0) {
    log('Nothing to do.');
    return { found, deleted: 0 };
  }
  if (!argv.includes('--confirm')) {
    log('Dry run: nothing was deleted. Re-run with --confirm to delete these rows.');
    return { found, deleted: 0 };
  }

  const res = (await db.$runCommandRaw({
    delete: COLLECTION,
    deletes: [{ q: query, limit: 0 }],
  })) as { n?: number };
  const deleted = res.n ?? 0;
  log(`Deleted ${deleted} row(s).`);
  return { found, deleted };
}

// Run only when executed directly (tsx scripts/migrations/...), not when imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { prisma } = await import('../../src/lib/prisma.js');
  try {
    await run(process.argv.slice(2), prisma);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
