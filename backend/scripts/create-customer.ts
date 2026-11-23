import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/lib/password.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * T-026 helper: create one verified CUSTOMER for the preview check's `--long` step
 * (`PREVIEW_CUSTOMER_EMAIL` / `PREVIEW_CUSTOMER_PASSWORD` in `.env.preview-check`).
 *
 * Run from `backend/` against the database in `.env`:
 *
 *     npx tsx scripts/create-customer.ts
 *
 * For the preview database, point DATABASE_URL at it for this one run (PowerShell):
 *
 *     $env:DATABASE_URL = '<the furnixa_preview connection string>'; npx tsx scripts/create-customer.ts
 *
 * The password is generated, printed ONCE and stored only as an argon2id hash. Refused in
 * production: accounts there go through the real registration flow (AUTH-01).
 */

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to create a shortcut account with NODE_ENV=production (AUTH-01).');
    process.exit(1);
  }

  const email = `preview-customer-${randomBytes(3).toString('hex')}@example.com`;
  // Registration policy (AUTH-03): 8-128 chars, at least one letter and one number.
  const password = `${randomBytes(12).toString('base64url')}a1`;

  const user = await prisma.user.create({
    data: {
      firstName: 'Preview',
      lastName: 'Customer',
      email,
      passwordHash: await hashPassword(password),
      role: 'CUSTOMER',
      isVerified: true,
      isBlocked: false,
      preferredLocale: 'en',
      // Rule 8: writers set optional fields to explicit null.
      phone: null,
      avatar: null,
      lockedUntil: null,
      passwordChangedAt: null,
      invitedById: null,
    },
  });

  const dbName = new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, '') || '(default)';
  console.log(`Created verified CUSTOMER ${user.id} in database "${dbName}"`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('Shown once only — put both into backend/.env.preview-check now.');
}

void main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
