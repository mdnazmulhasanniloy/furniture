import type { Request, RequestHandler } from 'express';
import { finishAfterCommit } from '../../lib/afterResponse.js';
import type { CreateCategoryBody, UpdateCategoryBody } from './schema.js';
import * as service from './service.js';

const idParam = (req: Request) => String(req.params.id);
const ctx = (req: Request) => ({
  log: req.log,
  requestId: String(req.id),
  uploadedById: req.user!.id,
});

export const publicTree: RequestHandler = async (_req, res) => {
  res.status(200).json(await service.getPublicTree());
};

export const listAdmin: RequestHandler = async (_req, res) => {
  res.status(200).json(await service.listAdmin());
};

export const create: RequestHandler = async (req, res) => {
  res.status(201).json(await service.create(req.body as CreateCategoryBody, ctx(req)));
};

export const update: RequestHandler = async (req, res) => {
  const { category, release } = await service.update(
    idParam(req),
    req.body as UpdateCategoryBody,
    ctx(req),
  );
  await finishAfterCommit(release, () => res.status(200).json(category));
};

export const remove: RequestHandler = async (req, res) => {
  const { release } = await service.remove(idParam(req), ctx(req));
  await finishAfterCommit(release, () => res.status(204).end());
};
