import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Locale, OtpPurpose, Prisma } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
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

/**
 * Prisma on MongoDB: `consumedAt: null` does not match a document where the field is absent, so
 * match both (rows are created with an explicit null, but other writers, e.g. admin invites, may not).
 */
export const UNCONSUMED: Prisma.OtpWhereInput = {
  OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
};

export const hashOtp = (email: string, code: string) => hmac('otp', `${email}:${code}`);

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** AUTH-04: 60 s cooldown and at most 5 OTPs per hour per email + purpose (computed from DB rows, so it holds across instances). */
export async function assertCanIssue(email: string, purpose: OtpPurpose, now = new Date()): Promise<void> {
  const latest = await prisma.otp.findFirst({ where: { email, purpose }, orderBy: { createdAt: 'desc' } });
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
      expiresAt: new Date(now.getTime() + getEnv().OTP_TTL_SECONDS * 1000),
      createdAt: now,
      consumedAt: null,
      pendingRegistration: args.pendingRegistration,
    },
  });
  return code;
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
 * Finds the live VERIFY_EMAIL OTP matching `code`. Wrong codes count per email across all live rows;
 * the 5th wrong code invalidates every row.
 */
export async function matchVerifyOtp(email: string, code: string) {
  const now = new Date();
  const live = await prisma.otp.findMany({
    where: { email, purpose: 'VERIFY_EMAIL', ...UNCONSUMED, expiresAt: { gt: now } },
  });
  if (live.length === 0) throw new AppError(400, 'OTP_EXPIRED', 'Code expired or not found');

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
