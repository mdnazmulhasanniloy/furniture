import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getEnv, type Env } from './config/env.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.js';
import { requestId } from './middleware/requestId.js';
import { authRouter } from './modules/auth/routes.js';
import { meRouter } from './modules/me/routes.js';
import { uploadsRouter } from './modules/uploads/routes.js';

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
  const app = express();

  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

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
  v1.use('/admin/uploads', uploadsRouter);
  for (const { path, router } of extraRouters) v1.use(path, router);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

export const app = createApp();
export default app;
