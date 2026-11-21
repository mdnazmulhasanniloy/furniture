import type { Request, RequestHandler } from 'express';
import type { CreateAddressBody, UpdateAddressBody, UpdateProfileBody } from './schema.js';
import * as service from './service.js';

const uid = (req: Request) => req.user!.id;
const idParam = (req: Request) => String(req.params.id);

export const updateProfile: RequestHandler = async (req, res) => {
  res.status(200).json(await service.updateProfile(uid(req), req.body as UpdateProfileBody));
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
