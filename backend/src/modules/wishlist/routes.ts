import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { mergeBody } from './schema.js';

export const wishlistRouter = Router();

// Customers only (FAV-01): an admin gets 403. The static `/merge` route is registered before `/:productId`.
wishlistRouter.use(requireAuth, requireRole('CUSTOMER'));
wishlistRouter.get('/', controller.getWishlist);
wishlistRouter.delete('/', controller.clear);
wishlistRouter.post('/merge', validate({ body: mergeBody }), controller.merge);
wishlistRouter.put('/:productId', controller.add);
wishlistRouter.delete('/:productId', controller.remove);
