/**
 * Safety guards of the demo-data reset. They run before any database, R2 or network call.
 * The reset deletes real collections, so every check here fails closed.
 */

export const ALLOWED_DB_NAMES = ['furniture_dev', 'furniture_preview'] as const;

export class DemoGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoGuardError';
  }
}

/** Database name of a MongoDB connection string (the path segment), or null when it cannot be read. */
export function parseDbName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  const m = /^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]*)/i.exec(databaseUrl.trim());
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** `mongodb+srv://***@host/db`: never print credentials or query options. */
export function maskDatabaseUrl(databaseUrl: string): string {
  return databaseUrl.replace(/\/\/[^@/]*@/, '//***@').replace(/\?.*$/, '');
}

export interface GuardInput {
  nodeEnv: string | undefined;
  databaseUrl: string | undefined;
}

/** Throws unless NODE_ENV is `development` AND the database is exactly furniture_dev / furniture_preview. */
export function assertSafeTarget({ nodeEnv, databaseUrl }: GuardInput): { dbName: string } {
  if (nodeEnv !== 'development') {
    throw new DemoGuardError(
      `Refusing to run: NODE_ENV must be "development" (got ${JSON.stringify(nodeEnv ?? null)}).`,
    );
  }
  const dbName = parseDbName(databaseUrl);
  if (dbName === null || !(ALLOWED_DB_NAMES as readonly string[]).includes(dbName)) {
    throw new DemoGuardError(
      `Refusing to run: the DATABASE_URL database must be exactly ${ALLOWED_DB_NAMES.join(' or ')} (got ${JSON.stringify(dbName)}).`,
    );
  }
  return { dbName };
}

export const hasConfirmFlag = (argv: readonly string[]): boolean => argv.includes('--confirm');
