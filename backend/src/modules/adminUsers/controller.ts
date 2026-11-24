import type { Request, RequestHandler } from 'express';
import * as service from './service.js';
import type {
  BlockBody,
  BlockCustomerBody,
  DeleteCustomerBody,
  UpdateCustomerBody,
  CustomerOrdersQuery,
  InviteAdminBody,
  ListCustomersQuery,
} from './schema.js';

const MESSAGES = {
  inviteResent: {
    en: 'A new invite code was sent',
    ar: 'تم إرسال رمز دعوة جديد',
  },
};

/** The response language follows the ADMIN's Accept-Language; the invite email itself uses the invitee's stored locale. */
const adminLocale = (req: Request): 'en' | 'ar' =>
  (req.get('accept-language') ?? '').toLowerCase().startsWith('en') ? 'en' : 'ar';

export const listCustomers: RequestHandler = async (req, res) => {
  res.status(200).json(await service.listCustomers(req.query as unknown as ListCustomersQuery));
};

export const getCustomer: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(
      await service.getCustomer(
        req.params.id as string,
        req.query as unknown as CustomerOrdersQuery,
      ),
    );
};

const customerCtx = (req: Request) => ({ log: req.log, requestId: String(req.id) });

export const blockCustomer: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(
      await service.blockCustomer(
        req.user!,
        req.params.id as string,
        req.body as BlockCustomerBody,
        customerCtx(req),
      ),
    );
};

export const updateCustomer: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(
      await service.updateCustomer(
        req.user!,
        req.params.id as string,
        req.body as UpdateCustomerBody,
        customerCtx(req),
      ),
    );
};

export const deleteCustomer: RequestHandler = async (req, res) => {
  res
    .status(200)
    .json(
      await service.deleteCustomer(
        req.user!,
        req.params.id as string,
        req.body as DeleteCustomerBody,
        customerCtx(req),
      ),
    );
};

export const listAdmins: RequestHandler = async (_req, res) => {
  res.status(200).json(await service.listAdmins());
};

export const inviteAdmin: RequestHandler = async (req, res) => {
  res.status(201).json(await service.inviteAdmin(req.user!, req.body as InviteAdminBody));
};

export const resendInvite: RequestHandler = async (req, res) => {
  await service.resendInvite(req.params.id as string);
  res.status(200).json({ message: MESSAGES.inviteResent[adminLocale(req)] });
};

export const blockAdmin: RequestHandler = async (req, res) => {
  const { isBlocked } = req.body as BlockBody;
  res.status(200).json(await service.blockAdmin(req.user!, req.params.id as string, isBlocked));
};
