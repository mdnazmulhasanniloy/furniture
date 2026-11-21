import { waitUntil } from '@vercel/functions';
import type { Request, RequestHandler } from 'express';
import type {
  CreateAddressBody,
  PresignAvatarBody,
  UpdateAddressBody,
  UpdateProfileBody,
} from './schema.js';
import * as service from './service.js';

const uid = (req: Request) => req.user!.id;
const idParam = (req: Request) => String(req.params.id);
const ctx = (req: Request) => ({ log: req.log, requestId: String(req.id) });

export const limitAvatarPresign: RequestHandler = async (req, _res, next) => {
  await service.limitAvatarPresign(uid(req), ctx(req));
  next();
};

export const presignAvatar: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(await service.presignAvatar(uid(req), req.body as PresignAvatarBody, ctx(req)));
};

export const updateProfile: RequestHandler = async (req, res) => {
  const { user, release } = await service.updateProfile(
    uid(req),
    req.body as UpdateProfileBody,
    ctx(req),
  );
  if (process.env.VERCEL) {
    // Respond first; waitUntil keeps the function alive for the cleanup (T-028).
    res.status(200).json(user);
    waitUntil(release());
  } else {
    // Release before responding: deterministic for callers and tests (releaseUploads never throws).
    await release();
    res.status(200).json(user);
  }
};
export const listAddresses: RequestHandler = async (req, res) => {
  res.status(200).json(await service.listAddresses(uid(req)));
};
export const createAddress: RequestHandler = async (req, res) => {
  res.status(201).json(await service.createAddress(uid(req), req.body as CreateAddressBody));
};
export const updateAddress: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(await service.updateAddress(uid(req), idParam(req), req.body as UpdateAddressBody));
};
export const deleteAddress: RequestHandler = async (req, res) => {
  await service.deleteAddress(uid(req), idParam(req));
  res.status(204).end();
};
