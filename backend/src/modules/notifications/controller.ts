import type { RequestHandler } from 'express';
import type { ListNotificationsQuery } from './schema.js';
import * as service from './service.js';

export const list: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(
      await service.listMyNotifications(
        req.user!.id,
        req.query as unknown as ListNotificationsQuery,
      ),
    );
};

export const markRead: RequestHandler = async (req, res) => {
  await service.markRead(req.user!.id, req.params.id as string);
  res.status(204).end();
};

export const markAllRead: RequestHandler = async (req, res) => {
  await service.markAllRead(req.user!.id);
  res.status(204).end();
};
