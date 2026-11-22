import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { getCartQuery, mergeBody, putItemBody } from './schema.js';

export const cartRouter = Router();

// Customers only (owner 2026-11-22): an admin gets 403.
cartRouter.use(requireAuth, requireRole('CUSTOMER'));
cartRouter.get('/', validate({ query: getCartQuery }), controller.getCart);
cartRouter.put('/items', validate({ body: putItemBody }), controller.putItem);
cartRouter.post('/merge', validate({ body: mergeBody }), controller.merge);
