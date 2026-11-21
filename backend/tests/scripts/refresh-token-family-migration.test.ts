import { execSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database: this test inserts legacy rows and must not touch any other test's data.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_migration_t005',
  );
});

import { prisma } from '../../src/lib/prisma.js';
import { run } from '../../scripts/migrations/2026-11-21-refresh-token-family.js';

const log = vi.fn();

/** A pre-T-005 row: written with raw MongoDB because Prisma now requires familyId. */
const insertLegacy = (userId: string, tokenHash: string, extra: Record<string, unknown> = {}) =>
  prisma.$runCommandRaw({
    insert: 'RefreshToken',
    documents: [
      {
        userId: { $oid: userId },
        tokenHash,
        expiresAt: { $date: new Date(Date.now() + 1e7).toISOString() },
        createdAt: { $date: new Date().toISOString() },
        ...extra,
      },
    ],
  });

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
let userId = '';
beforeEach(async () => {
  log.mockClear();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  userId = (
    await prisma.user.create({
      data: {
        firstName: 'M',
        lastName: 'Igrate',
        email: 'm@example.com',
        passwordHash: 'x',
        isVerified: true,
      },
    })
  ).id;
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

const seed = async () => {
  await insertLegacy(userId, 'legacy-missing');
  await insertLegacy(userId, 'legacy-null', { familyId: null });
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId: 'fam-1',
      tokenHash: 'current',
      expiresAt: new Date(Date.now() + 1e7),
    },
  });
};

describe('migrate:refresh-family (T-005, ADR-001)', () => {
  it('T-005 · without --confirm it prints the count and deletes nothing', async () => {
    await seed();
    const res = await run([], prisma, log);
    expect(res).toEqual({ found: 2, deleted: 0 });
    expect(log).toHaveBeenCalledWith('RefreshToken rows without familyId: 2');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('--confirm'));
    const left = (await prisma.$runCommandRaw({ count: 'RefreshToken' })) as { n: number };
    expect(left.n).toBe(3);
  });

  it('T-005 · with --confirm it deletes only rows without familyId (missing or null)', async () => {
    await seed();
    const res = await run(['--confirm'], prisma, log);
    expect(res).toEqual({ found: 2, deleted: 2 });
    const rows = await prisma.refreshToken.findMany();
    expect(rows.map((r) => r.tokenHash)).toEqual(['current']);
  });

  it('T-005 · --all without --confirm counts every refresh token and deletes nothing', async () => {
    await seed();
    const res = await run(['--all'], prisma, log, 'development');
    expect(res).toEqual({ found: 3, deleted: 0 });
    expect(log).toHaveBeenCalledWith('RefreshToken rows: 3');
    const left = (await prisma.$runCommandRaw({ count: 'RefreshToken' })) as { n: number };
    expect(left.n).toBe(3); // nothing deleted
  });

  it('T-005 · --all --confirm deletes every refresh token, with and without familyId', async () => {
    await seed();
    expect(await run(['--all', '--confirm'], prisma, log, 'development')).toEqual({
      found: 3,
      deleted: 3,
    });
    const left = (await prisma.$runCommandRaw({ count: 'RefreshToken' })) as { n: number };
    expect(left.n).toBe(0);
    // the users are untouched
    expect(await prisma.user.count()).toBe(1);
  });

  it('T-005 · --all is refused when NODE_ENV=production, even with --confirm, and deletes nothing', async () => {
    await seed();
    await expect(run(['--all', '--confirm'], prisma, log, 'production')).rejects.toThrow(
      /refused when NODE_ENV=production/,
    );
    await expect(run(['--all'], prisma, log, 'production')).rejects.toThrow(/production/);
    const left = (await prisma.$runCommandRaw({ count: 'RefreshToken' })) as { n: number };
    expect(left.n).toBe(3);
  });

  it('T-005 · the default (familyId-less) mode still works in production', async () => {
    await seed();
    expect(await run(['--confirm'], prisma, log, 'production')).toEqual({ found: 2, deleted: 2 });
  });

  it('T-005 · it is idempotent: a second --confirm run finds nothing', async () => {
    await seed();
    await run(['--confirm'], prisma, log);
    expect(await run(['--confirm'], prisma, log)).toEqual({ found: 0, deleted: 0 });
    expect(await prisma.refreshToken.count()).toBe(1);
  });
});
