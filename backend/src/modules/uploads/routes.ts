import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { presignBody } from './schema.js';

export const uploadsRouter = Router();

// Auth first, then the per-admin limiter (counts every request), then validation.
uploadsRouter.post(
  '/presign',
  requireAuth,
  requireRole('ADMIN'),
  controller.limitPresign,
  validate({ body: presignBody }),
  controller.presign,
);
