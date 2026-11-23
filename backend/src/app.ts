import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getEnv, type Env } from './config/env.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.js';
import { requestId } from './middleware/requestId.js';
import { adminAdminsRouter, adminCustomersRouter } from './modules/adminUsers/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { createCronRouter } from './modules/cron/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { cartRouter } from './modules/cart/routes.js';
import { adminCategoriesRouter, categoriesRouter } from './modules/categories/routes.js';
import {
  adminBannersRouter,
  adminHomeSectionsRouter,
  adminPagesRouter,
  adminSettingsRouter,
  cmsRouter,
} from './modules/cms/routes.js';
import { meRouter } from './modules/me/routes.js';
import { registerNotificationConsumers } from './modules/notifications/consumers.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { registerOrderEmailConsumers } from './modules/orders/emails.js';
import { adminOrdersRouter, ordersRouter } from './modules/orders/routes.js';
import { adminProductsRouter, productsRouter } from './modules/products/routes.js';
import { uploadsRouter } from './modules/uploads/routes.js';
import { restoreOriginalUrl } from './lib/vercelUrl.js';

export interface CreateAppOptions {
  env?: Env;
  /** Extra routers mounted under /api/v1 (tests mount a test-only admin router; none in production). */
  extraRouters?: { path: string; router: Router }[];
  /** Tests that must capture real log output pass their own logger (the test environment logs nothing). */
  logger?: Logger;
}

const isOptions = (v: Env | CreateAppOptions): v is CreateAppOptions =>
  'extraRouters' in v || 'env' in v || 'logger' in v;

/** `createApp()`, `createApp(env)` or `createApp({ env?, extraRouters?, logger? })`. */
export function createApp(arg: Env | CreateAppOptions = {}) {
  const {
    env = getEnv(),
    extraRouters = [],
    logger: given,
  }: CreateAppOptions = 'NODE_ENV' in arg ? { env: arg } : isOptions(arg) ? arg : {};
  const logger = given ?? createLogger(env);
  registerOrderEmailConsumers(); // ORD-04 (T-014); idempotent across createApp calls
  registerNotificationConsumers(); // NOTIF-01/02 (T-016); idempotent across createApp calls
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  // Vercel's backend-framework routing invokes the function with the rewrite DESTINATION as
  // `req.url` (/api/index); vercel.json carries the requested path in `__originalPath`. Restore it
  // before anything logs or routes. A no-op everywhere else (dev, tests, old routing behaviour).
  app.use((req, _res, next) => {
    restoreOriginalUrl(req, '/api/index');
    next();
  });

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => (req as express.Request).id }));
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      origin(origin, cb) {
        // No Origin header = same-origin or non-browser client; otherwise it must be allow-listed.
        cb(null, !origin || env.CORS_ALLOWED_ORIGINS.includes(origin));
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  const v1 = Router();
  v1.use('/auth', authRouter);
  v1.use('/me', meRouter);
  v1.use('/cart', cartRouter);
  v1.use('/orders', ordersRouter);
  v1.use('/categories', categoriesRouter);
  v1.use('/products', productsRouter);
  v1.use('/cms', cmsRouter);
  v1.use('/notifications', notificationsRouter);
  v1.use('/admin/dashboard', dashboardRouter);
  v1.use('/admin/customers', adminCustomersRouter);
  v1.use('/admin/admins', adminAdminsRouter);
  v1.use('/admin/orders', adminOrdersRouter);
  v1.use('/admin/categories', adminCategoriesRouter);
  v1.use('/admin/products', adminProductsRouter);
  v1.use('/admin/banners', adminBannersRouter);
  v1.use('/admin/home-sections', adminHomeSectionsRouter);
  v1.use('/admin/pages', adminPagesRouter);
  v1.use('/admin/settings', adminSettingsRouter);
  v1.use('/admin/uploads', uploadsRouter);
  for (const { path, router } of extraRouters) v1.use(path, router);
  app.use('/api/v1', v1);

  // T-025 (NFR-08): Vercel Cron target, not under /api/v1; unset CRON_SECRET -> not mounted (404).
  if (env.CRON_SECRET) app.use('/internal/cron', createCronRouter(env.CRON_SECRET));

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

export const app = createApp();
export default app;
