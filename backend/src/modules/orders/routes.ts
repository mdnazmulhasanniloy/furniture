import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { listOrdersQuery, placeOrderBody } from './schema.js';

export const ordersRouter = Router();

// Customers only (same rule as the cart, T-012): an admin gets 403.
ordersRouter.use(requireAuth, requireRole('CUSTOMER'));
ordersRouter.post('/', validate({ body: placeOrderBody }), controller.placeOrder);
ordersRouter.get('/', validate({ query: listOrdersQuery }), controller.listMyOrders);
ordersRouter.get('/:id', controller.getMyOrder);
