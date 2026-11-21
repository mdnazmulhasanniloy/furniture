import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import { createCategoryBody, updateCategoryBody } from './schema.js';

/** Public catalog routes (CAT-01). */
export const categoriesRouter = Router();
categoriesRouter.get('/', controller.publicTree);

/** Admin CRUD (ADM-03). */
export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(requireAuth, requireRole('ADMIN'));
adminCategoriesRouter.get('/', controller.listAdmin);
adminCategoriesRouter.post('/', validate({ body: createCategoryBody }), controller.create);
adminCategoriesRouter.patch('/:id', validate({ body: updateCategoryBody }), controller.update);
adminCategoriesRouter.delete('/:id', controller.remove);
