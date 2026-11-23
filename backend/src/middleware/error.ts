import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { captureException } from '../lib/sentry.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (err instanceof AppError) {
      ({ status, code, message, details } = err);
    } else if (err instanceof ZodError) {
      status = 422;
      code = 'VALIDATION_ERROR';
      message = 'Validation failed';
      details = err.issues;
    } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
      // body-parser and similar errors (malformed JSON, payload too large)
      status = err.status;
      code = status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      message = 'Invalid request';
    }

    if (status >= 500) {
      logger.error({ err, requestId: req.id }, 'unhandled error');
      captureException(err, req.id);
    }

    const retryAfter = (details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (status === 429 && typeof retryAfter === 'number' && !res.getHeader('Retry-After')) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfter))));
    }

    // Rate limiters with `refundErrorCodes` (T-019) read the rendered code to decide whether to refund.
    res.locals.errorCode = code;
    res.status(status).json({ code, message, details, requestId: req.id });
  };
}
