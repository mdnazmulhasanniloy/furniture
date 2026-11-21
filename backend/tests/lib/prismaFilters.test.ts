import { execSync } from 'node:child_process';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_prisma_filters',
  );
});

import { prisma } from '../../src/lib/prisma.js';
import { UNATTACHED } from '../../src/lib/r2.js';
import { UNREVOKED } from '../../src/lib/tokens.js';
import { UNCONSUMED } from '../../src/modules/auth/otp.service.js';

const OID = '0123456789abcdef01234567';

beforeAll(() => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  await prisma.otp.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.upload.deleteMany();
});
afterAll(async () => {
  await prisma.otp.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.$disconnect();
});

/**
 * Prisma on MongoDB: `{ field: null }` matches only an explicit null, not a MISSING field. Each
 * "field is empty" filter must therefore match a document created WITHOUT the field (notSet, T-028).
 */
describe('prisma null-vs-missing filters', () => {
  it('AUTH-01 · UNCONSUMED matches an Otp row created without consumedAt (field missing)', async () => {
    await prisma.otp.create({
      data: {
        email: 'missing@example.com',
        purpose: 'VERIFY_EMAIL',
        codeHash: 'x'.repeat(64),
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const raw = await prisma.otp.findRaw({ filter: { consumedAt: { $exists: false } } });
    expect(raw).toHaveLength(1); // precondition: the field really is missing
    const found = await prisma.otp.findFirst({
      where: { AND: [{ email: 'missing@example.com' }, UNCONSUMED] },
    });
    expect(found).not.toBeNull();
  });

  it('AUTH-05 · UNREVOKED matches a RefreshToken row created without revokedAt (field missing)', async () => {
    await prisma.refreshToken.create({
      data: {
        userId: OID,
        familyId: 'fam-1',
        tokenHash: 'h'.repeat(64),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const raw = await prisma.refreshToken.findRaw({ filter: { revokedAt: { $exists: false } } });
    expect(raw).toHaveLength(1);
    const found = await prisma.refreshToken.findFirst({
      where: { AND: [{ userId: OID }, UNREVOKED] },
    });
    expect(found).not.toBeNull();
  });

  it('ADM-02 · UNATTACHED matches an Upload row created without attachedAt (field missing)', async () => {
    await prisma.upload.create({
      data: {
        key: 'furnixa/test/2026/11/00000000-0000-4000-8000-000000000000.png',
        uploadedById: OID,
        contentType: 'image/png',
        size: 1,
        scope: 'admin',
      },
    });
    const raw = await prisma.upload.findRaw({ filter: { attachedAt: { $exists: false } } });
    expect(raw).toHaveLength(1);
    const found = await prisma.upload.findFirst({
      where: { AND: [{ uploadedById: OID }, UNATTACHED] },
    });
    expect(found).not.toBeNull();
  });
});
