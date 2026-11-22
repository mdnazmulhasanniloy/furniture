import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import * as controller from './controller.js';

// ADM-01 (T-018): dashboard summary, admins only.
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireRole('ADMIN'));
dashboardRouter.get('/summary', controller.summary);
