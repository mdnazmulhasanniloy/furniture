import type { RequestHandler } from 'express';
import * as service from './service.js';

export const summary: RequestHandler = async (_req, res) => {
  res.status(200).json(await service.dashboardSummary());
};
