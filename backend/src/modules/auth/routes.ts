import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { registerBody, resendOtpBody, verifyOtpBody } from './schema.js';

export const authRouter = Router();

authRouter.post('/register', validate({ body: registerBody }), controller.register);
authRouter.post('/verify-otp', validate({ body: verifyOtpBody }), controller.verifyOtp);
authRouter.post('/resend-otp', validate({ body: resendOtpBody }), controller.resendOtp);
