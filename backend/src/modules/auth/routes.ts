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

authRouter.post('/register', validate({ body: registerBody }), controller.register);
authRouter.post('/verify-otp', validate({ body: verifyOtpBody }), controller.verifyOtp);
authRouter.post('/resend-otp', validate({ body: resendOtpBody }), controller.resendOtp);
authRouter.post('/login', loginIpLimiter, validate({ body: loginBody }), controller.login);
authRouter.post(
  '/forgot-password',
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
authRouter.post('/refresh', controller.refresh);
authRouter.post('/logout', controller.logout);
authRouter.get('/me', requireAuth, controller.me);
