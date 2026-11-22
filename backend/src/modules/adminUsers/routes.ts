import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { blockBody, customerOrdersQuery, inviteAdminBody, listCustomersQuery } from './schema.js';

// ADM-05 (T-017): customers list/detail/block, admins only.
export const adminCustomersRouter = Router();
adminCustomersRouter.use(requireAuth, requireRole('ADMIN'));
adminCustomersRouter.get('/', validate({ query: listCustomersQuery }), controller.listCustomers);
adminCustomersRouter.get('/:id', validate({ query: customerOrdersQuery }), controller.getCustomer);
adminCustomersRouter.patch('/:id/block', validate({ body: blockBody }), controller.blockCustomer);

// ADM-11 (T-017): list/invite/resend-invite/block admins, admins only.
export const adminAdminsRouter = Router();
adminAdminsRouter.use(requireAuth, requireRole('ADMIN'));
adminAdminsRouter.get('/', controller.listAdmins);
adminAdminsRouter.post('/', validate({ body: inviteAdminBody }), controller.inviteAdmin);
adminAdminsRouter.post('/:id/resend-invite', controller.resendInvite);
adminAdminsRouter.patch('/:id/block', validate({ body: blockBody }), controller.blockAdmin);
