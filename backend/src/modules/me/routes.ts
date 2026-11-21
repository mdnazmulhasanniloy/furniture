import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { createAddressBody, updateAddressBody, updateProfileBody } from './schema.js';

export const meRouter = Router();

meRouter.use(requireAuth);
meRouter.patch('/', validate({ body: updateProfileBody }), controller.updateProfile);
meRouter.get('/addresses', controller.listAddresses);
meRouter.post('/addresses', validate({ body: createAddressBody }), controller.createAddress);
meRouter.patch('/addresses/:id', validate({ body: updateAddressBody }), controller.updateAddress);
meRouter.delete('/addresses/:id', controller.deleteAddress);
