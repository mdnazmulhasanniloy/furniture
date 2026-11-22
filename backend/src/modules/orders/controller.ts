import type { RequestHandler } from 'express';
import {
  idempotencyKey,
  type AdminListOrdersQuery,
  type AdminNoteBody,
  type ListOrdersQuery,
  type OrderStatusBody,
  type PlaceOrderBody,
} from './schema.js';
import * as service from './service.js';

export const placeOrder: RequestHandler = async (req, res) => {
  // Missing or malformed header -> ZodError -> 422 VALIDATION_ERROR (error middleware).
  const key = idempotencyKey.parse(req.get('Idempotency-Key'));
  const { order, replay } = await service.placeOrder(
    req.user!.id,
    req.body as PlaceOrderBody,
    key.toLowerCase(),
    { log: req.log, requestId: req.id },
  );
  // An idempotent replay answers 200 with the identical body of the original 201.
  res.status(replay ? 200 : 201).json(service.toCustomerOrder(order));
};

export const listMyOrders: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(await service.listMyOrders(req.user!.id, req.query as unknown as ListOrdersQuery));
};

export const getMyOrder: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getMyOrder(req.user!.id, req.params.id as string));
};

// ---------------------------------------------------------------- ADM-04 admin orders (T-014)

export const adminListOrders: RequestHandler = async (req, res) => {
  res.status(200).json(await service.listAdminOrders(req.query as unknown as AdminListOrdersQuery));
};

export const adminGetOrder: RequestHandler = async (req, res) => {
  res.status(200).json(await service.getAdminOrder(req.params.id as string));
};

export const adminSetStatus: RequestHandler = async (req, res) => {
  const body = req.body as OrderStatusBody;
  res.status(200).json(
    await service.transitionStatus(req.params.id as string, body.status, body.note, req.user!.id, {
      log: req.log,
      requestId: req.id,
    }),
  );
};

export const adminSetNote: RequestHandler = async (req, res) => {
  const body = req.body as AdminNoteBody;
  res.status(200).json(await service.setAdminNote(req.params.id as string, body.adminNote));
};
