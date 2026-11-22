import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  adminListOrdersQuery,
  adminNoteBody,
  listOrdersQuery,
  orderStatusBody,
  placeOrderBody,
} from './schema.js';

export const ordersRouter = Router();

// Customers only (same rule as the cart, T-012): an admin gets 403.
ordersRouter.use(requireAuth, requireRole('CUSTOMER'));
ordersRouter.post('/', validate({ body: placeOrderBody }), controller.placeOrder);
ordersRouter.get('/', validate({ query: listOrdersQuery }), controller.listMyOrders);
ordersRouter.get('/:id', controller.getMyOrder);

// ADM-04 (T-014): list/detail/status/note, admins only.
export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAuth, requireRole('ADMIN'));
adminOrdersRouter.get('/', validate({ query: adminListOrdersQuery }), controller.adminListOrders);
adminOrdersRouter.get('/:id', controller.adminGetOrder);
adminOrdersRouter.patch(
  '/:id/status',
  validate({ body: orderStatusBody }),
  controller.adminSetStatus,
);
adminOrdersRouter.patch('/:id/note', validate({ body: adminNoteBody }), controller.adminSetNote);
