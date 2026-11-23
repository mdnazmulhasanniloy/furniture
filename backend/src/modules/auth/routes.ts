import { Router } from 'express';
import { createRateLimiter } from '../../lib/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  acceptInviteBody,
  forgotPasswordBody,
  loginBody,
  registerBody,
  resendOtpBody,
  resetPasswordBody,
  verifyOtpBody,
} from './schema.js';

export const authRouter = Router();

/** AUTH-02: 10 failed attempts / 15 min / IP (successful logins are not counted). */
const loginIpLimiter = createRateLimiter({
  name: 'login',
  limit: 10,
  windowSeconds: 900,
  skipSuccessful: true,
});

/** AUTH-03: 10 failed resets / 15 min / IP, so codes cannot be guessed across many emails. */
const resetIpLimiter = createRateLimiter({
  name: 'reset-password',
  limit: 10,
  windowSeconds: 900,
  skipSuccessful: true,
});

/** T-019 (NFR-01): per-email caps exist, but one IP can flood many different emails (rows + mail). */
const registerIpLimiter = createRateLimiter({ name: 'register', limit: 20, windowSeconds: 3600 });

/** T-019 (NFR-01): the 5-wrong-code burn is per email; this stops guessing across rotating emails. */
const verifyOtpIpLimiter = createRateLimiter({
  name: 'verify-otp',
  limit: 10,
  windowSeconds: 900,
  skipSuccessful: true,
});

/** T-019 (NFR-01): cooldown and hourly cap are per email; this caps mass mail across many emails. */
const resendOtpIpLimiter = createRateLimiter({
  name: 'resend-otp',
  limit: 20,
  windowSeconds: 3600,
});

/** T-019 (NFR-01): same flow as resend-otp, same per-IP cap. */
const forgotPasswordIpLimiter = createRateLimiter({
  name: 'forgot-password',
  limit: 20,
  windowSeconds: 3600,
});

/** T-019 (NFR-01): only real failures count — not successes and not the 401 REFRESH_RACE grace case
 *  (a multi-tab client retrying with the new cookie is not a guessing attempt). */
const refreshIpLimiter = createRateLimiter({
  name: 'refresh',
  limit: 20,
  windowSeconds: 900,
  skipSuccessful: true,
  refundErrorCodes: ['REFRESH_RACE'],
});

authRouter.post(
  '/register',
  registerIpLimiter,
  validate({ body: registerBody }),
  controller.register,
);
authRouter.post(
  '/verify-otp',
  verifyOtpIpLimiter,
  validate({ body: verifyOtpBody }),
  controller.verifyOtp,
);
authRouter.post(
  '/resend-otp',
  resendOtpIpLimiter,
  validate({ body: resendOtpBody }),
  controller.resendOtp,
);
authRouter.post('/login', loginIpLimiter, validate({ body: loginBody }), controller.login);
authRouter.post(
  '/forgot-password',
  forgotPasswordIpLimiter,
  validate({ body: forgotPasswordBody }),
  controller.forgotPassword,
);
authRouter.post(
  '/reset-password',
  resetIpLimiter,
  validate({ body: resetPasswordBody }),
  controller.resetPassword,
);
/** ADM-11 (T-017): same guessing protection as reset-password — 10 failed accepts / 15 min / IP. */
const acceptInviteIpLimiter = createRateLimiter({
  name: 'accept-invite',
  limit: 10,
  windowSeconds: 900,
  skipSuccessful: true,
});

authRouter.post(
  '/accept-invite',
  acceptInviteIpLimiter,
  validate({ body: acceptInviteBody }),
  controller.acceptInvite,
);
authRouter.get('/csrf', controller.csrf);
authRouter.post('/refresh', refreshIpLimiter, controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', requireAuth, controller.me);
