import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

/** Validates request parts with zod. A failure becomes 422 VALIDATION_ERROR via the error handler. */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      // Express 5 exposes req.query as a getter, so redefine it with the parsed value.
      if (schemas.query) {
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
        });
      }
      // zod 4's ZodType outputs `unknown`; the parsed value is still Express params-shaped.
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      next();
    } catch (err) {
      next(err);
    }
  };
}
