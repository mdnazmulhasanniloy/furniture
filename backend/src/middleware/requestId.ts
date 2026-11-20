import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const VALID = /^[A-Za-z0-9._-]{1,128}$/;

declare module 'express-serve-static-core' {
  interface Request {
    id: string;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
};
