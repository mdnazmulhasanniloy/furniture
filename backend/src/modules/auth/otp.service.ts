import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Locale, OtpPurpose, Prisma } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { notSet } from '../../lib/prismaFilters.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { hmac } from '../../lib/tokens.js';

export const OTP_COOLDOWN_SECONDS = 60;
export const OTP_HOURLY_CAP = 5;
export const OTP_MAX_ATTEMPTS = 5;

export interface PendingRegistration {
  passwordHash: string;
  firstName: string;
  lastName: string;
  preferredLocale: Locale;
}

/** Null-or-missing (see prismaFilters.ts); rows are created with an explicit null, but other writers, e.g. admin invites, may not. */
export const UNCONSUMED = notSet<Prisma.OtpWhereInput>('consumedAt');

export const hashOtp = (email: string, code: string) => hmac('otp', `${email}:${code}`);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** AUTH-04: 60 s cooldown and at most 5 OTPs per hour per email + purpose (computed from DB rows, so it holds across instances). */
export async function assertCanIssue(
  email: string,
  purpose: OtpPurpose,
  now = new Date(),
): Promise<void> {
  const latest = await prisma.otp.findFirst({
    where: { email, purpose },
    orderBy: { createdAt: 'desc' },
  });
  if (latest) {
    const waitMs = latest.createdAt.getTime() + OTP_COOLDOWN_SECONDS * 1000 - now.getTime();
    if (waitMs > 0) {
      throw new AppError(429, 'RATE_LIMITED', 'Please wait before requesting another code', {
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }
  }
  const lastHour = await prisma.otp.count({
    where: { email, purpose, createdAt: { gt: new Date(now.getTime() - 3_600_000) } },
  });
  if (lastHour >= OTP_HOURLY_CAP) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many codes requested; try again later', {
      retryAfterSeconds: 3600,
    });
  }
}

/** Code validity per purpose: invites live `INVITE_TTL_SECONDS` (48 h default, T-017), the rest `OTP_TTL_SECONDS`. */
const ttlSecondsFor = (purpose: OtpPurpose): number =>
  purpose === 'INVITE_ADMIN' ? getEnv().INVITE_TTL_SECONDS : getEnv().OTP_TTL_SECONDS;

/** Creates an OTP row and returns the plaintext code (only the keyed hash is stored). */
export async function createOtp(args: {
  email: string;
  purpose: OtpPurpose;
  pendingRegistration?: PendingRegistration;
}): Promise<string> {
  const now = new Date();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // Wrong-code attempts are counted per email, so a new row inherits the attempts already spent.
  const active = await prisma.otp.aggregate({
    where: { email: args.email, purpose: args.purpose, ...UNCONSUMED, expiresAt: { gt: now } },
    _max: { attempts: true },
  });
  await prisma.otp.create({
    data: {
      email: args.email,
      purpose: args.purpose,
      codeHash: hashOtp(args.email, code),
      attempts: active._max.attempts ?? 0,
      expiresAt: new Date(now.getTime() + ttlSecondsFor(args.purpose) * 1000),
      createdAt: now,
      consumedAt: null,
      pendingRegistration: args.pendingRegistration,
    },
  });
  return code;
}

let dummyHash: Promise<string> | undefined;

/**
 * T-027 (also used by the T-005 unverified login): the pending registration of `email` whose password
 * hash matches `password`, among unexpired VERIFY_EMAIL rows. Rows burnt by the 5-wrong-codes lockout still count (the password is the proof), so a locked-out user can ask for a fresh code. Newest first, so the first
 * match wins. A miss still costs one argon2 verify so response time does not reveal whether rows exist.
 */
export async function findPendingByPassword(
  email: string,
  password: string,
): Promise<PendingRegistration | undefined> {
  const rows = await prisma.otp.findMany({
    where: {
      email,
      purpose: 'VERIFY_EMAIL',
      expiresAt: { gt: new Date() },
      pendingRegistration: { isSet: true },
    },
    orderBy: { createdAt: 'desc' },
  });
  for (const row of rows) {
    const pending = row.pendingRegistration;
    if (pending && (await verifyPassword(pending.passwordHash, password))) return pending;
  }
  if (rows.length === 0)
    await verifyPassword(
      await (dummyHash ??= hashPassword(randomBytes(16).toString('hex'))),
      password,
    );
  return undefined;
}

/**
 * Row that only counts toward the cooldown / hourly cap. Used for emails that get no mail, so a 429
 * looks the same for known and unknown emails. Born consumed: it can never be verified.
 */
export async function createDecoyOtp(email: string, purpose: OtpPurpose): Promise<void> {
  const now = new Date();
  await prisma.otp.create({
    data: {
      email,
      purpose,
      codeHash: randomBytes(32).toString('hex'),
      expiresAt: now,
      consumedAt: now,
      createdAt: now,
    },
  });
}

/**
 * Finds the live OTP of `purpose` matching `code`. Wrong codes count per email across all live rows;
 * the 5th wrong code invalidates every row. With no live row the error is `noLiveRow` (VERIFY_EMAIL says
 * `OTP_EXPIRED`; RESET_PASSWORD says `OTP_INVALID` so it cannot reveal whether an account exists).
 */
export async function matchOtp(
  email: string,
  purpose: OtpPurpose,
  code: string,
  noLiveRow: 'OTP_EXPIRED' | 'OTP_INVALID' = 'OTP_EXPIRED',
) {
  const now = new Date();
  const live = await prisma.otp.findMany({
    where: { email, purpose, ...UNCONSUMED, expiresAt: { gt: now } },
  });
  if (live.length === 0) {
    throw noLiveRow === 'OTP_INVALID'
      ? new AppError(400, 'OTP_INVALID', 'Invalid code')
      : new AppError(400, 'OTP_EXPIRED', 'Code expired or not found');
  }

  const hash = hashOtp(email, code);
  const match = live.find((row) => safeEqual(row.codeHash, hash));
  if (match) return match;

  const attempts = Math.max(...live.map((r) => r.attempts)) + 1;
  const ids = live.map((r) => r.id);
  await prisma.otp.updateMany({
    where: { id: { in: ids } },
    data: attempts >= OTP_MAX_ATTEMPTS ? { attempts, consumedAt: now } : { attempts },
  });
  throw new AppError(400, 'OTP_INVALID', 'Invalid code');
}

export const matchVerifyOtp = (email: string, code: string) =>
  matchOtp(email, 'VERIFY_EMAIL', code);
