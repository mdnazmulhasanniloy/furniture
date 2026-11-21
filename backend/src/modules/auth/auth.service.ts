import type { Locale, Prisma, User } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { mailer } from '../../emails/mailer.js';
import { AppError } from '../../lib/errors.js';
import { dummyVerify, hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { limitKey, resetKeyInTx } from '../../lib/rateLimit.js';
import { issueRefreshToken, revokeAllForUser, signAccessToken } from '../../lib/tokens.js';
import {
  assertCanIssue,
  createDecoyOtp,
  createOtp,
  findPendingByPassword,
  matchOtp,
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

export async function sendOtpEmail(args: {
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

/** AUTH-03: same flow, limits and identical response as the RESET_PASSWORD resend. */
export const forgotPassword = (email: string, headerLocale: Locale | undefined) =>
  resendOtp(email, 'RESET_PASSWORD', undefined, headerLocale);

const otpInvalid = () => new AppError(400, 'OTP_INVALID', 'Invalid code');
const isWriteConflict = (e: unknown) => (e as { code?: string })?.code === 'P2034';

/**
 * AUTH-03. Every failure to match a live code is the same 400 OTP_INVALID (unknown email included) and
 * spends one argon2 verify, so neither the body nor the timing reveals whether the account exists.
 * ACCOUNT_BLOCKED only follows a correct code. Does not log the user in.
 */
export async function resetPassword(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  let match;
  try {
    match = await matchOtp(email, 'RESET_PASSWORD', code, 'OTP_INVALID');
  } catch (err) {
    await dummyVerify(newPassword);
    throw err;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isVerified) {
    await dummyVerify(newPassword);
    throw otpInvalid();
  }
  if (user.isBlocked) throw new AppError(403, 'ACCOUNT_BLOCKED', 'Account blocked');

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.otp.updateMany({
        where: { id: match.id, ...UNCONSUMED, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (claimed.count === 0) throw otpInvalid(); // lost the race for this one-time code
      await tx.otp.updateMany({
        where: { email, purpose: 'RESET_PASSWORD', ...UNCONSUMED },
        data: { consumedAt: now },
      });
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
      });
      await revokeAllForUser(user.id, tx);
      await resetKeyInTx(tx, limitKey('login', 'email', email));
    });
  } catch (err) {
    if (isWriteConflict(err)) throw otpInvalid(); // a concurrent reset with the same code won
    throw err;
  }

  void mailer.sendInBackground({
    to: email,
    template: 'password-changed',
    locale: user.preferredLocale,
    data: { firstName: user.firstName },
  });
}
