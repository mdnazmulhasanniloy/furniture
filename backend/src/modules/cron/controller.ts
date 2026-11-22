import type { RequestHandler } from 'express';
import * as service from './service.js';

export const cleanup: RequestHandler = async (req, res) => {
  res.status(200).json(await service.runCleanup({ log: req.log, requestId: String(req.id) }));
};
