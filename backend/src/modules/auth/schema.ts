import { z } from 'zod';

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const name = z.string().trim().min(1).max(40);

/**
 * Shape only: a non-empty string of at most 128 characters. The strength rules (src/lib/passwordPolicy.ts) are
 * asserted in the service with `assertStrongPassword`, so a weak password is 400 `PASSWORD_TOO_WEAK` naming every
 * unmet rule instead of an opaque 422 (owner 2026-11-24).
 */
export const password = z.string().min(1).max(128);

export const locale = z.enum(['ar', 'en']);
const otpPurpose = z.enum(['VERIFY_EMAIL', 'RESET_PASSWORD']);

export const registerBody = z.object({
  firstName: name,
  lastName: name,
  email,
  password,
  preferredLocale: locale.optional(),
});

/** No complexity rules on login: only the registration/reset rules apply when a password is chosen. */
export const loginBody = z.object({ email, password: z.string().min(1).max(128) });

export const verifyOtpBody = z.object({ email, code: z.string().regex(/^\d{6}$/) });

/** VERIFY_EMAIL resend must prove knowledge of the registration password (T-027); RESET_PASSWORD takes none. */
export const resendOtpBody = z
  .object({ email, purpose: otpPurpose, password: z.string().min(1).max(128).optional() })
  .refine((v) => v.purpose !== 'VERIFY_EMAIL' || v.password !== undefined, {
    path: ['password'],
    message: 'password is required for VERIFY_EMAIL',
  });

export const forgotPasswordBody = z.object({ email });

export const resetPasswordBody = z.object({
  email,
  code: z.string().regex(/^\d{6}$/),
  newPassword: password,
});

/** ADM-11 (T-017): the invitee sets their own password with the invite code. */
export const acceptInviteBody = z.object({
  email,
  code: z.string().regex(/^\d{6}$/),
  password,
});

export type ResendOtpBody = z.infer<typeof resendOtpBody>;
export type RegisterBody = z.infer<typeof registerBody>;
