import type { Request, RequestHandler } from 'express';
import { finishAfterCommit } from '../../lib/afterResponse.js';
import { revalidateTags } from '../../lib/revalidate.js';
import type {
  AdminListQuery,
  CreateProductBody,
  PublicListQuery,
  UpdateProductBody,
} from './schema.js';
import * as service from './service.js';

const idParam = (req: Request) => String(req.params.id);
const ctx = (req: Request) => ({
  log: req.log,
  requestId: String(req.id),
  uploadedById: req.user!.id,
});
const productTags = (slug: string, oldSlug?: string) => [
  'products',
  `product:${slug}`,
  ...(oldSlug !== undefined && oldSlug !== slug ? [`product:${oldSlug}`] : []),
];

export const listPublic: RequestHandler = async (req, res) => {
  res.status(200).json(await service.listPublic(req.query as unknown as PublicListQuery));
};

export const publicDetail: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getPublicBySlug(String(req.params.slug)));
};

export const listAdmin: RequestHandler = async (req, res) => {
  res.status(200).json(await service.listAdmin(req.query as unknown as AdminListQuery));
};

export const getById: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getById(idParam(req)));
};

export const create: RequestHandler = async (req, res) => {
  const product = await service.create(req.body as CreateProductBody, ctx(req));
  await finishAfterCommit(
    () => revalidateTags(productTags(product.slug)),
    () => res.status(201).json(product),
  );
};

export const update: RequestHandler = async (req, res) => {
  const { product, oldSlug, release } = await service.update(
    idParam(req),
    req.body as UpdateProductBody,
    ctx(req),
  );
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(productTags(product.slug, oldSlug));
    },
    () => res.status(200).json(product),
  );
};

export const remove: RequestHandler = async (req, res) => {
  const { slug, release } = await service.remove(idParam(req), ctx(req));
  await finishAfterCommit(
    async () => {
      await release();
      await revalidateTags(productTags(slug));
    },
    () => res.status(204).end(),
  );
};
