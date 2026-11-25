import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import * as controller from './controller.js';
import {
  appearancePatchBody,
  createBannerBody,
  createPageBody,
  createSectionBody,
  putSettingsBody,
  reorderBody,
  updateBannerBody,
  updatePageBody,
  updateSectionBody,
} from './schema.js';

/** Public CMS reads (ADM-06..09): home composition, active settings, published pages. */
export const cmsRouter = Router();
cmsRouter.get('/home', controller.getHome);
cmsRouter.get('/settings', controller.getPublicSettings);
cmsRouter.get('/pages/:slug', controller.getPublicPage);

/** Admin banners (ADM-06). */
export const adminBannersRouter = Router();
adminBannersRouter.use(requireAuth, requireRole('ADMIN'));
adminBannersRouter.get('/', controller.listBanners);
adminBannersRouter.post('/', validate({ body: createBannerBody }), controller.createBanner);
// CR-011: bulk order for the admin's drag to reorder. Declared before '/:id' so 'order' is never read as an id.
adminBannersRouter.put('/order', validate({ body: reorderBody }), controller.reorderBanners);
adminBannersRouter.patch('/:id', validate({ body: updateBannerBody }), controller.updateBanner);
adminBannersRouter.delete('/:id', controller.removeBanner);

/** Admin home sections (ADM-07). */
export const adminHomeSectionsRouter = Router();
adminHomeSectionsRouter.use(requireAuth, requireRole('ADMIN'));
adminHomeSectionsRouter.get('/', controller.listSections);
adminHomeSectionsRouter.post('/', validate({ body: createSectionBody }), controller.createSection);
adminHomeSectionsRouter.put(
  '/reorder',
  validate({ body: reorderBody }),
  controller.reorderSections,
);
adminHomeSectionsRouter.patch(
  '/:id',
  validate({ body: updateSectionBody }),
  controller.updateSection,
);
adminHomeSectionsRouter.delete('/:id', controller.removeSection);

/** Admin pages (ADM-08). */
export const adminPagesRouter = Router();
adminPagesRouter.use(requireAuth, requireRole('ADMIN'));
adminPagesRouter.get('/', controller.listPages);
adminPagesRouter.post('/', validate({ body: createPageBody }), controller.createPage);
adminPagesRouter.patch('/:id', validate({ body: updatePageBody }), controller.updatePage);
adminPagesRouter.delete('/:id', controller.removePage);

/** Admin settings (ADM-09; city rules land in T-022). */
export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAuth, requireRole('ADMIN'));
adminSettingsRouter.get('/', controller.getAdminSettings);
adminSettingsRouter.put('/', validate({ body: putSettingsBody }), controller.putSettings);
// ADM-16 (CR-010): the colour theme has its own PATCH so the full-replace PUT above keeps its contract.
adminSettingsRouter.get('/appearance', controller.getAppearance);
adminSettingsRouter.patch(
  '/appearance',
  validate({ body: appearancePatchBody }),
  controller.patchAppearance,
);
