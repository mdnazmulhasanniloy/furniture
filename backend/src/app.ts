import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { getEnv, type Env } from './config/env.js';
import { createLogger } from './lib/logger.js';
import { createErrorHandler, notFoundHandler } from './middleware/error.js';
import { requestId } from './middleware/requestId.js';

export function createApp(env: Env = getEnv()) {
  const logger = createLogger(env);
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
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));
  return app;
}

export const app = createApp();
export default app;
