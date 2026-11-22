import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { listNotificationsQuery } from './schema.js';

export const notificationsRouter = Router();

// NOTIF-03 / ADM-10: any authenticated user — everyone reads only their own rows.
notificationsRouter.use(requireAuth);
notificationsRouter.get('/', validate({ query: listNotificationsQuery }), controller.list);
notificationsRouter.post('/read-all', controller.markAllRead);
notificationsRouter.patch('/:id/read', controller.markRead);
