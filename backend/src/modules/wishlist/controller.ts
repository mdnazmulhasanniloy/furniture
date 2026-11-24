import type { RequestHandler } from 'express';
import type { MergeBody } from './schema.js';
import * as service from './service.js';

export const getWishlist: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getWishlist(req.user!.id));
};

export const add: RequestHandler = async (req, res) => {
  res.status(200).json(await service.add(req.user!.id, String(req.params.productId)));
};

export const remove: RequestHandler = async (req, res) => {
  res.status(200).json(await service.remove(req.user!.id, String(req.params.productId)));
};

export const clear: RequestHandler = async (req, res) => {
  await service.clear(req.user!.id);
  res.status(204).end();
};

export const merge: RequestHandler = async (req, res) => {
  res.status(200).json(await service.merge(req.user!.id, req.body as MergeBody));
};
