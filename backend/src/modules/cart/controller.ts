import type { RequestHandler } from 'express';
import type { GetCartQuery, MergeBody, PutItemBody } from './schema.js';
import * as service from './service.js';

export const getCart: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getCart(req.user!.id, req.query as GetCartQuery));
};

export const putItem: RequestHandler = async (req, res) => {
  res.status(200).json(await service.setItem(req.user!.id, req.body as PutItemBody));
};

export const merge: RequestHandler = async (req, res) => {
  res.status(200).json(await service.merge(req.user!.id, req.body as MergeBody));
};
