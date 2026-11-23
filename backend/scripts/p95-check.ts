/**
 * T-019 (NFR-02): p95 < 300 ms for list endpoints at 1k products.
 *
 * Modes (owner decision, 2026-11-23):
 *   - In-memory (default):   npx tsx scripts/p95-check.ts
 *     Spins up a local mongodb-memory-server replica set, seeds, measures, exits.
 *     Two concurrent in-memory runs cannot collide: each owns its own mongod on an
 *     OS-assigned free port with its own temp data directory, and the app listens on port 0.
 *   - Atlas: P95_DATABASE_URL points at a DEDICATED database named exactly `furniture_p95`
 *     (any other database name is refused), which this script seeds and DROPS at the end:
 *       PowerShell:  $env:P95_DATABASE_URL="mongodb+srv://user:pass@cluster/furniture_p95?retryWrites=true&w=majority"; npx tsx scripts/p95-check.ts
 *       bash:        P95_DATABASE_URL="mongodb+srv://user:pass@cluster/furniture_p95?retryWrites=true&w=majority" npx tsx scripts/p95-check.ts
 *     A `p95_lock` document guards the shared database: a second run refuses to start while a
 *     lock younger than 30 min exists (a crashed run's lock expires by itself; dropping the
 *     database in Atlas also clears it).
 *
 * Every setup phase (memory server start, PRIMARY check, db push, seed, app start) runs under
 * its own timeout and fails with a named error — this script never hangs silently.
 *
 * Exit code 0 only when every endpoint's p95 is under the 300 ms budget.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import path from 'node:path';
import { formatReport, measureEndpoints, type EndpointSpec } from './p95/harness.js';

const REQUIRED_DB = 'furniture_p95';
const BUDGET_MS = 300;
const PRODUCTS = 1000;
const ORDERS = 200;
const CUSTOMERS = 300;
const WARMUP = 25;
const SAMPLES = 200;
const LOCK_FRESH_MS = 30 * 60_000;
const BACKEND_DIR = path.resolve(import.meta.dirname, '..');

function databaseNameOf(url: string): string {
  const pathname = new URL(url).pathname;
  return decodeURIComponent(pathname.replace(/^\//, ''));
}

/** Rejects with a named error instead of hanging silently; the work itself is not cancelled. */
async function phase<T>(name: string, ms: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`phase "${name}" timed out after ${ms / 1000} s`)),
      ms,
    );
  });
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `prisma db push`, spawned ASYNC on purpose. Never use execSync/spawnSync here: in in-memory
 * mode this process owns the mongod and must keep draining its piped log output — a sync spawn
 * freezes the event loop, the log pipe fills during the index-build burst, mongod blocks on the
 * write and the push never returns (diagnosed on Windows, 2026-11-23). The prisma CLI is invoked
 * directly (no nested npx) for the same reason the tests' execSync works from a different process:
 * fewer layers between us and the child's exit.
 */
function dbPush(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--accept-data-loss'],
      { cwd: BACKEND_DIR, env: { ...process.env } },
    );
    let output = '';
    child.stdout.on('data', (d: Buffer) => (output += d.toString()));
    child.stderr.on('data', (d: Buffer) => (output += d.toString()));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`phase "prisma db push" timed out after 120 s\n${output.slice(-1500)}`));
    }, 120_000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`prisma db push exited with ${code}\n${output.slice(-1500)}`));
    });
  });
}

/** Confirms the target reports a writable PRIMARY before prisma connects. */
async function assertPrimary(url: string): Promise<void> {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(url, {
    serverSelectionTimeoutMS: 20_000,
    connectTimeoutMS: 20_000,
  });
  try {
    const started = Date.now();
    await client.connect();
    const hello = (await client.db('admin').command({ hello: 1 })) as {
      isWritablePrimary?: boolean;
    };
    if (!hello.isWritablePrimary) throw new Error('target is not a writable PRIMARY');
    console.log(`MongoDB PRIMARY confirmed in ${Date.now() - started} ms`);
  } finally {
    await client.close().catch(() => {});
  }
}

type RawDoc = { startedAt?: string | { $date: string }; pid?: number };
const lockDate = (d: RawDoc['startedAt']): Date =>
  new Date(typeof d === 'object' && d !== null ? d.$date : (d ?? 0));

async function main(): Promise<number> {
  const atlasUrl = process.env.P95_DATABASE_URL;
  let stopInfra: () => Promise<void> = async () => {};
  let mode: 'atlas' | 'in-memory';

  if (atlasUrl) {
    const dbName = databaseNameOf(atlasUrl);
    if (dbName !== REQUIRED_DB) {
      console.error(
        `Refusing to run: P95_DATABASE_URL must point at a database named exactly "${REQUIRED_DB}" ` +
          `(got "${dbName}"). This database is seeded and DROPPED at the end of the run.`,
      );
      return 1;
    }
    process.env.DATABASE_URL = atlasUrl;
    mode = 'atlas';
  } else {
    console.log(
      'starting in-memory MongoDB replica set (first run may download the MongoDB binary — that can take minutes) ...',
    );
    const replSet = await phase('memory server start', 300_000, async () => {
      const { MongoMemoryReplSet } = await import('mongodb-memory-server');
      return MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    });
    process.env.DATABASE_URL = replSet.getUri(REQUIRED_DB);
    stopInfra = () => replSet.stop().then(() => undefined);
    mode = 'in-memory';
    console.log('in-memory MongoDB up');
  }
  console.log(`p95 check — mode: ${mode}, database: ${REQUIRED_DB}, budget: p95 < ${BUDGET_MS} ms`);
  console.log(`seed: ${PRODUCTS} products, ${ORDERS} orders, ${CUSTOMERS} customers`);

  await phase('MongoDB PRIMARY check', 30_000, () => assertPrimary(process.env.DATABASE_URL!));

  // Per-request logs would drown the report (~1800 measured requests); errors still print.
  process.env.LOG_LEVEL ??= 'warn';
  // Import prisma/app only after DATABASE_URL points at the target database.
  const { prisma } = await import('../src/lib/prisma.js');

  // Atlas: the database is shared between runs — refuse while another run's lock is fresh.
  if (mode === 'atlas') {
    const found = (await prisma.$runCommandRaw({ find: 'p95_lock', filter: {} })) as {
      cursor?: { firstBatch?: RawDoc[] };
    };
    const lock = found.cursor?.firstBatch?.[0];
    if (lock && Date.now() - lockDate(lock.startedAt).getTime() < LOCK_FRESH_MS) {
      console.error(
        `Refusing to run: another p95 run holds the lock on "${REQUIRED_DB}" ` +
          `(started ${lockDate(lock.startedAt).toISOString()}, pid ${lock.pid ?? '?'}). ` +
          `Wait for it (locks expire after 30 min) or drop the database if that run crashed.`,
      );
      return 1;
    }
  }

  console.log('resetting database ...');
  // The run owns this database (fresh in-memory, or the dedicated Atlas DB): start clean.
  await phase('database reset', 60_000, async () => {
    await prisma.$runCommandRaw({ dropDatabase: 1 });
  });
  console.log('prisma db push ...');
  await dbPush();
  console.log('prisma db push done');
  if (mode === 'atlas') {
    await prisma.$runCommandRaw({
      insert: 'p95_lock',
      documents: [{ startedAt: { $date: new Date().toISOString() }, pid: process.pid }],
    });
  }

  const { createApp } = await import('../src/app.js');
  const { signAccessToken } = await import('../src/lib/tokens.js');
  const { hashPassword } = await import('../src/lib/password.js');
  const { buildSearchText } = await import('../src/lib/searchText.js');

  let server: Server | undefined;
  try {
    console.log('seeding ...');
    const admin = await phase('seed', 300_000, async () => {
      const passwordHash = await hashPassword('P95-check-Passw0rd');
      const adminUser = await prisma.user.create({
        data: {
          firstName: 'P95',
          lastName: 'Admin',
          email: 'p95-admin@example.com',
          passwordHash,
          isVerified: true,
          role: 'ADMIN',
        },
      });
      const customer = await prisma.user.create({
        data: {
          firstName: 'P95',
          lastName: 'Customer',
          email: 'p95-customer@example.com',
          passwordHash,
          isVerified: true,
        },
      });
      await prisma.user.createMany({
        data: Array.from({ length: CUSTOMERS }, (_, i) => ({
          firstName: `Shopper${i}`,
          lastName: 'Test',
          email: `p95-shopper-${i}@example.com`,
          passwordHash,
          isVerified: true,
        })),
      });

      await prisma.siteSetting.create({
        data: {
          key: 'default',
          storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
          contactEmail: 'p95@example.com',
          contactPhone: '+966551234567',
          vat: { vatRate: 15, applyToDelivery: true, pricesIncludeVat: true },
          deliveryCities: [
            {
              code: 'riyadh',
              name: { en: 'Riyadh', ar: 'الرياض' },
              isActive: true,
              sortOrder: 1,
              deliveryFee: null,
            },
          ],
        },
      });

      const categoryNames = ['sofas', 'tables', 'chairs', 'beds', 'storage', 'outdoor'];
      const categories: { id: string }[] = [];
      for (const [i, slug] of categoryNames.entries()) {
        categories.push(
          await prisma.category.create({
            data: {
              name: { en: slug, ar: `${slug} ع` },
              slug,
              image: null,
              parentId: null,
              sortOrder: i,
            },
          }),
        );
      }

      const materials = ['oak', 'walnut', 'steel', 'fabric', null];
      await prisma.product.createMany({
        data: Array.from({ length: PRODUCTS }, (_, i) => {
          const title = { en: `Sofa model ${i}`, ar: `أريكة طراز ${i}` };
          const resale = i % 4 === 0;
          return {
            slug: `p95-product-${i}`,
            title,
            description: { en: `Description ${i}`, ar: `وصف ${i}` },
            type: resale ? ('RESALE' as const) : ('NEW' as const),
            condition: resale ? ('GOOD' as const) : ('NEW' as const),
            price: 5_000 + (i % 200) * 100,
            compareAtPrice: null,
            stock: i % 10,
            categoryId: categories[i % categories.length]!.id,
            images: [],
            isFeatured: i % 25 === 0,
            status: 'PUBLISHED' as const,
            searchText: buildSearchText(title),
            sku: null,
            conditionNotes: null,
            dimensions: null,
            material: materials[i % materials.length],
            color: null,
          };
        }),
      });
      const products = await prisma.product.findMany({ select: { id: true }, take: 50 });

      const day = (i: number) => new Date(Date.now() - (i % 30) * 86_400_000);
      await prisma.order.createMany({
        data: Array.from({ length: ORDERS }, (_, i) => {
          const p = products[i % products.length]!;
          const unitPrice = 10_000;
          const qty = 1 + (i % 3);
          const statuses = [
            'PENDING',
            'CONFIRMED',
            'PROCESSING',
            'DELIVERED',
            'CANCELLED',
          ] as const;
          return {
            orderNo: `FX-P95-${String(i).padStart(5, '0')}`,
            userId: customer.id,
            idempotencyKey: randomUUID(),
            addressId: customer.id, // only kept for the idempotency mismatch check; any ObjectId works here
            items: [
              {
                productId: p.id,
                titleSnapshot: { en: `Item ${i}`, ar: `صنف ${i}` },
                sku: null,
                imageSnapshot: null,
                imageKey: null,
                unitPrice,
                qty,
                lineTotal: unitPrice * qty,
                type: 'NEW' as const,
                condition: 'NEW' as const,
              },
            ],
            address: {
              fullName: 'P95 Customer',
              phone: '+966551234567',
              cityCode: 'riyadh',
              city: { en: 'Riyadh', ar: 'الرياض' },
              area: 'Olaya',
              street: 'King Fahd Rd 12',
              notes: null,
            },
            subtotal: unitPrice * qty,
            deliveryFee: 0,
            vat: {
              vatRate: 15,
              vatAmount: 1304,
              applyToDelivery: true,
              pricesIncludeVat: true,
              registrationNumber: null,
            },
            total: unitPrice * qty,
            status: statuses[i % statuses.length],
            statusHistory: [
              { status: 'PENDING' as const, at: day(i), byUserId: customer.id, note: null },
            ],
            customerNote: null,
            adminNote: null,
            createdAt: day(i),
          };
        }),
      });

      await prisma.homeSection.createMany({
        data: [
          {
            type: 'FEATURED_PRODUCTS',
            title: { en: 'Featured', ar: 'مميز' },
            subtitle: null,
            config: { limit: 8 },
            sortOrder: 0,
            isVisible: true,
          },
          {
            type: 'NEW_ARRIVALS',
            title: { en: 'New arrivals', ar: 'وصل حديثاً' },
            subtitle: null,
            config: { limit: 8 },
            sortOrder: 1,
            isVisible: true,
          },
        ],
      });
      return adminUser;
    });
    console.log('seed done');

    const baseUrl = await phase('app start', 30_000, async () => {
      const app = createApp();
      server = app.listen(0);
      await new Promise<void>((resolve) => server!.once('listening', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no server port');
      return `http://127.0.0.1:${address.port}`;
    });
    const adminAuth = { Authorization: `Bearer ${signAccessToken(admin)}` };

    const endpoints: EndpointSpec[] = [
      { name: 'GET /products', path: '/api/v1/products?limit=24' },
      { name: 'GET /products (search)', path: '/api/v1/products?q=sofa&sort=price_asc&limit=24' },
      {
        name: 'GET /products (category p3)',
        path: '/api/v1/products?category=sofas&page=3&limit=24',
      },
      { name: 'GET /categories', path: '/api/v1/categories' },
      { name: 'GET /cms/home', path: '/api/v1/cms/home' },
      { name: 'GET /admin/products', path: '/api/v1/admin/products?limit=24', headers: adminAuth },
      { name: 'GET /admin/orders', path: '/api/v1/admin/orders?limit=20', headers: adminAuth },
      {
        name: 'GET /admin/customers',
        path: '/api/v1/admin/customers?limit=24',
        headers: adminAuth,
      },
    ];

    console.log(`measuring (${WARMUP} warmup + ${SAMPLES} samples per endpoint, sequential) ...\n`);
    const stats = await measureEndpoints(baseUrl, endpoints, { warmup: WARMUP, samples: SAMPLES });
    const report = formatReport(stats, BUDGET_MS);
    console.log(report.lines.join('\n'));
    console.log(
      `\n${mode} run: ${report.pass ? 'PASS' : 'FAIL'} (NFR-02: p95 < ${BUDGET_MS} ms at ${PRODUCTS} products)`,
    );
    return report.pass ? 0 : 1;
  } finally {
    if (server) {
      // fetch (undici) keeps keep-alive sockets open; close() alone would wait on them forever.
      server.closeAllConnections();
      await new Promise((resolve) => server!.close(resolve));
    }
    if (mode === 'atlas') {
      console.log(`dropping database ${REQUIRED_DB} (also releases the p95_lock) ...`);
      await prisma.$runCommandRaw({ dropDatabase: 1 });
    }
    await prisma.$disconnect();
    await stopInfra();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
