import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const name = z.string().trim().min(1).max(40);

/** PRD AUTH-03: 8-128 characters, at least one letter and one number. */
export const password = z
  .string()
  .min(8)
  .max(128)
  .refine(
    (v) => /\p{L}/u.test(v) && /\d/.test(v),
    'Password must contain at least one letter and one number',
  );

const locale = z.enum(['ar', 'en']);
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

export type ResendOtpBody = z.infer<typeof resendOtpBody>;
export type RegisterBody = z.infer<typeof registerBody>;
