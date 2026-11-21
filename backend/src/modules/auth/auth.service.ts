import type { Locale, Prisma, User } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { mailer } from '../../emails/mailer.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { issueRefreshToken, signAccessToken } from '../../lib/tokens.js';
import {
  assertCanIssue,
  createDecoyOtp,
  createOtp,
  findPendingByPassword,
  matchVerifyOtp,
  UNCONSUMED,
  type PendingRegistration,
} from './otp.service.js';
import type { RegisterBody } from './schema.js';

export function toPublicUser(u: User) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role,
    phone: u.phone,
    avatar: u.avatar,
    isVerified: u.isVerified,
    isBlocked: u.isBlocked,
    preferredLocale: u.preferredLocale,
    createdAt: u.createdAt,
  };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002';

async function sendOtpEmail(args: {
  email: string;
  template: 'otp-verify' | 'otp-reset';
  code: string;
  firstName: string;
  locale: Locale | undefined;
}) {
  await mailer.send({
    to: args.email,
    template: args.template,
    locale: args.locale,
    data: { firstName: args.firstName, code: args.code, ttlSeconds: getEnv().OTP_TTL_SECONDS },
  });
}

/**
 * AUTH-01. An existing unverified account is never modified: the submitted data travels on the new
 * OTP row and is applied only when that OTP is verified (no pre-account takeover).
 */
export async function register(
  body: RegisterBody,
  headerLocale: Locale | undefined,
): Promise<void> {
  const { email } = body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && (existing.isVerified || existing.role !== 'CUSTOMER')) {
    throw new AppError(409, 'EMAIL_IN_USE', 'Email already in use');
  }
  await assertCanIssue(email, 'VERIFY_EMAIL');

  const pending: PendingRegistration = {
    passwordHash: await hashPassword(body.password),
    firstName: body.firstName,
    lastName: body.lastName,
    preferredLocale: body.preferredLocale ?? headerLocale ?? 'ar',
  };

  if (!existing) {
    try {
      await prisma.user.create({ data: { email, ...pending } });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // lost a race with another register: keep that account untouched
    }
  }

  const code = await createOtp({ email, purpose: 'VERIFY_EMAIL', pendingRegistration: pending });
  await sendOtpEmail({
    email,
    template: 'otp-verify',
    code,
    firstName: body.firstName,
    locale: headerLocale ?? body.preferredLocale,
  });
}

/** AUTH-01: verify, apply the matched OTP's pending data, consume every VERIFY_EMAIL OTP, log in. */
export async function verifyOtp(email: string, code: string, userAgent?: string) {
  const match = await matchVerifyOtp(email, code);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AppError(400, 'OTP_EXPIRED', 'Code expired or not found');
  if (user.isBlocked) throw new AppError(403, 'ACCOUNT_BLOCKED', 'Account blocked');

  const now = new Date();
  const verified = await prisma.$transaction(async (tx) => {
    const claimed = await tx.otp.updateMany({
      where: { id: match.id, ...UNCONSUMED },
      data: { consumedAt: now },
    });
    if (claimed.count === 0) throw new AppError(400, 'OTP_EXPIRED', 'Code expired or not found');
    const data: Prisma.UserUpdateInput = { isVerified: true };
    if (match.pendingRegistration) Object.assign(data, match.pendingRegistration);
    const updated = await tx.user.update({ where: { id: user.id }, data });
    await tx.otp.updateMany({
      where: { email, purpose: 'VERIFY_EMAIL', ...UNCONSUMED },
      data: { consumedAt: now },
    });
    return updated;
  });

  const refreshToken = await issueRefreshToken(verified.id, userAgent);
  return { user: verified, accessToken: signAccessToken(verified), refreshToken };
}

/**
 * AUTH-04 / T-027. Same outcome for known and unknown emails; only applicable accounts get a mail.
 * VERIFY_EMAIL needs the registration password: the new OTP is bound to the pending registration whose
 * password matches, so a later attacker registration can never receive the victim's resent code.
 */
export async function resendOtp(
  email: string,
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
  password: string | undefined,
  headerLocale: Locale | undefined,
): Promise<void> {
  await assertCanIssue(email, purpose);
  const user = await prisma.user.findUnique({ where: { email } });

  const applicable =
    user && !user.isBlocked && (purpose === 'VERIFY_EMAIL' ? !user.isVerified : user.isVerified);
  if (!user || !applicable) {
    await createDecoyOtp(email, purpose);
    return;
  }

  if (purpose === 'VERIFY_EMAIL') {
    const pending =
      password === undefined ? undefined : await findPendingByPassword(email, password);
    if (!pending) {
      await createDecoyOtp(email, purpose);
      return;
    }
    const code = await createOtp({ email, purpose, pendingRegistration: pending });
    await sendOtpEmail({
      email,
      template: 'otp-verify',
      code,
      firstName: pending.firstName,
      locale: headerLocale ?? pending.preferredLocale,
    });
    return;
  }

  const code = await createOtp({ email, purpose });
  await sendOtpEmail({
    email,
    template: 'otp-reset',
    code,
    firstName: user.firstName,
    locale: headerLocale ?? user.preferredLocale,
  });
}
