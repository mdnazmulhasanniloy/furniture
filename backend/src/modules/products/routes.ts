import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { adminListQuery, createProductBody, publicListQuery, updateProductBody } from './schema.js';

/** Public catalog routes (PROD-01, PROD-02). */
export const productsRouter = Router();
productsRouter.get('/', validate({ query: publicListQuery }), controller.listPublic);
productsRouter.get('/:slug', controller.publicDetail);

/** Admin CRUD (ADM-02). */
export const adminProductsRouter = Router();
adminProductsRouter.use(requireAuth, requireRole('ADMIN'));
adminProductsRouter.get('/', validate({ query: adminListQuery }), controller.listAdmin);
adminProductsRouter.post('/', validate({ body: createProductBody }), controller.create);
adminProductsRouter.get('/:id', controller.getById);
adminProductsRouter.patch('/:id', validate({ body: updateProductBody }), controller.update);
adminProductsRouter.delete('/:id', controller.remove);
