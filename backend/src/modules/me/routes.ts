import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  createAddressBody,
  presignAvatarBody,
  updateAddressBody,
  updateProfileBody,
} from './schema.js';

export const meRouter = Router();

meRouter.use(requireAuth);
meRouter.patch('/', validate({ body: updateProfileBody }), controller.updateProfile);
// Rate limiter runs before validation so rejected requests still count toward the limit.
meRouter.post(
  '/avatar/presign',
  controller.limitAvatarPresign,
  validate({ body: presignAvatarBody }),
  controller.presignAvatar,
);
meRouter.get('/addresses', controller.listAddresses);
meRouter.post('/addresses', validate({ body: createAddressBody }), controller.createAddress);
meRouter.patch('/addresses/:id', validate({ body: updateAddressBody }), controller.updateAddress);
meRouter.delete('/addresses/:id', controller.deleteAddress);
