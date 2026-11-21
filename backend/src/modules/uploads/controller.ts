import type { RequestHandler } from 'express';
import type { PresignBody } from './schema.js';
import * as service from './service.js';

export const limitPresign: RequestHandler = async (req, _res, next) => {
  await service.limitPresign(req.user!.id, { log: req.log, requestId: String(req.id) });
  next();
};

export const presign: RequestHandler = async (req, res) => {
  res.status(200).json(await service.presign(req.user!.id, req.body as PresignBody));
};
