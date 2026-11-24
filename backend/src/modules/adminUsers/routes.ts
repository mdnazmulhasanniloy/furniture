import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  blockBody,
  blockCustomerBody,
  customerOrdersQuery,
  deleteCustomerBody,
  inviteAdminBody,
  listCustomersQuery,
  updateCustomerBody,
} from './schema.js';

// ADM-05 (T-017): customers list/detail/block, admins only.
export const adminCustomersRouter = Router();
adminCustomersRouter.use(requireAuth, requireRole('ADMIN'));
adminCustomersRouter.get('/', validate({ query: listCustomersQuery }), controller.listCustomers);
adminCustomersRouter.get('/:id', validate({ query: customerOrdersQuery }), controller.getCustomer);
adminCustomersRouter.patch('/:id/block', validate({ body: blockCustomerBody }), controller.blockCustomer);
// CR-011 (ADM-17): name and phone only, and soft delete with anonymisation.
adminCustomersRouter.patch('/:id', validate({ body: updateCustomerBody }), controller.updateCustomer);
adminCustomersRouter.delete('/:id', validate({ body: deleteCustomerBody }), controller.deleteCustomer);

// ADM-11 (T-017): list/invite/resend-invite/block admins, admins only.
export const adminAdminsRouter = Router();
adminAdminsRouter.use(requireAuth, requireRole('ADMIN'));
adminAdminsRouter.get('/', controller.listAdmins);
adminAdminsRouter.post('/', validate({ body: inviteAdminBody }), controller.inviteAdmin);
adminAdminsRouter.post('/:id/resend-invite', controller.resendInvite);
adminAdminsRouter.patch('/:id/block', validate({ body: blockBody }), controller.blockAdmin);
