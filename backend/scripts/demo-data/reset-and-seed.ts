import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { assertSafeTarget, DemoGuardError, hasConfirmFlag, maskDatabaseUrl } from './guards.js';
import { getImage, loadManifest, type ManifestImage } from './images.js';

/**
 * Demo-data reset + seed for LOCAL DEVELOPMENT ONLY.
 *
 *   npm run demo:reset              # dry run: prints what would be deleted, exits 1
 *   npm run demo:reset -- --confirm # resets and seeds
 *
 * Requires NODE_ENV=development and a DATABASE_URL database named exactly furniture_dev or furniture_preview.
 * Run `npm run seed` first (it creates the admin user and the SiteSetting with the delivery cities).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
export const MANIFEST_FILE = path.join(here, 'images.json');
export const CACHE_DIR = path.join(here, '.cache');
export const MIN_PASSWORD_LENGTH = 12;

export interface RunDeps {
  prisma: PrismaClient;
  /** Returns a validated image for a manifest entry (default: allowlisted, cached download). */
  imageSource?: (m: ManifestImage) => ReturnType<typeof getImage>;
  manifestFile?: string;
  log?: (message: string) => void;
}

export interface RunOptions {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  /** Called only after every guard has passed, so a refused run never constructs a database client. */
  deps: () => Promise<RunDeps>;
}

/** Returns the process exit code. 0 = reset and seed done; 1 = refused or dry run; 2 = failed. */
export async function run({ argv, env, deps }: RunOptions): Promise<number> {
  const log = (m: string) => console.log(m);
  try {
    const { dbName } = assertSafeTarget({ nodeEnv: env.NODE_ENV, databaseUrl: env.DATABASE_URL });
    const confirm = hasConfirmFlag(argv);
    const password = env.DEMO_CUSTOMER_PASSWORD ?? '';
    if (confirm && password.length < MIN_PASSWORD_LENGTH) {
      throw new DemoGuardError(
        `Refusing to run: DEMO_CUSTOMER_PASSWORD must be set to at least ${MIN_PASSWORD_LENGTH} characters.`,
      );
    }

    const d = await deps();
    const say = d.log ?? log;
    const { planReset, resetDemoData, demoPrefix } = await import('./reset.js');

    say(`Target database: ${dbName} (${maskDatabaseUrl(env.DATABASE_URL ?? '')})`);
    say(`Demo R2 prefix:  ${demoPrefix()}`);
    const plan = await planReset(d.prisma);
    say('\nThe reset will DELETE:');
    for (const [name, n] of Object.entries(plan.counts)) say(`  ${String(n).padStart(6)}  ${name}`);
    say('Kept untouched:');
    for (const [name, n] of Object.entries(plan.kept)) say(`  ${String(n).padStart(6)}  ${name}`);
    say('  (and the rate-limit / OTP / counter / cron collections)');
    if (plan.foreignImageKeys.length > 0) {
      say(
        `\n${plan.foreignImageKeys.length} image(s) outside the demo prefix are referenced by data that will be deleted.\n` +
          'Their uploads and R2 objects are NOT touched:',
      );
      for (const k of plan.foreignImageKeys.slice(0, 20)) say(`  - ${k}`);
      if (plan.foreignImageKeys.length > 20)
        say(`  ... and ${plan.foreignImageKeys.length - 20} more`);
    }
    if (!confirm) {
      say('\nDry run only. Re-run with --confirm to delete and re-seed.');
      return 1;
    }

    const admin = await d.prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
    if (!admin) throw new Error('No admin user found: run "npm run seed" first.');
    const settings = await d.prisma.siteSetting.findUnique({ where: { key: 'default' } });
    if (!settings) throw new Error('SiteSetting is missing: run "npm run seed" first.');

    // Fetch and validate every image BEFORE deleting anything: a network failure must not leave an empty shop.
    const manifest = await loadManifest(d.manifestFile ?? MANIFEST_FILE);
    const source = d.imageSource ?? ((m: ManifestImage) => getImage(m.imageUrl, CACHE_DIR));
    say(`\nChecking ${manifest.length} images (host allowlist, type, size, magic bytes)...`);
    for (const m of manifest) await source(m);

    say('\nResetting...');
    const result = await resetDemoData(d.prisma);
    for (const [name, n] of Object.entries(result.deleted)) say(`  deleted ${n} ${name}`);
    say(`  deleted ${result.r2Deleted} R2 object(s)`);
    if (result.r2Failed.length > 0) {
      say(
        `  WARNING: ${result.r2Failed.length} R2 object(s) could not be deleted; their upload rows were kept.`,
      );
    }

    say('\nSeeding...');
    const { seedDemoData } = await import('./seed.js');
    const { seedOrders } = await import('./orders.js');
    const now = new Date();
    const seeded = await seedDemoData(d.prisma, {
      adminId: admin.id,
      manifest,
      imageSource: source,
      customerPassword: password,
      now,
      log: say,
    });
    await seedOrders(d.prisma, {
      adminId: admin.id,
      customers: seeded.customers,
      products: seeded.products,
      now,
      log: say,
    });
    say(`\nDone. ${seeded.uploads} images uploaded under ${demoPrefix()}`);
    say('Customer logins: <email from the demo list>@example.com with DEMO_CUSTOMER_PASSWORD.');
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    return err instanceof DemoGuardError ? 1 : 2;
  }
}

async function main() {
  await import('dotenv/config'); // only when run as a script, never when imported by tests
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    deps: async () => ({ prisma: (await import('../../src/lib/prisma.js')).prisma }),
  });
  const { prisma } = await import('../../src/lib/prisma.js');
  await prisma.$disconnect();
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
