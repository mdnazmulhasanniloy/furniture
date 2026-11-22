import type { Order } from '@prisma/client';
import { waitUntil } from '@vercel/functions';
import { mailer } from '../../emails/index.js';
import { onOrderEvent } from '../../lib/orderEvents.js';
import { prisma } from '../../lib/prisma.js';

/**
 * ORD-04 order emails (T-014): `order.created` -> `order-placed`, `order.statusChanged` ->
 * `order-status`, both in the customer's `preferredLocale`. The events fire strictly after commit
 * (T-013); on Vercel the WHOLE handler task (the user read included, not only the SMTP send) is
 * registered with `waitUntil` so the function is not frozen before the mail leaves. Failures are
 * logged and never fail the request (`emitOrderEvent` + `sendInBackground` both catch). Emails
 * carry no internal data: templates render only order/status fields — never `adminNote`, a status
 * note, or the raw `customerNote` (owner 2026-11-22).
 */

/** The handler's returned promise also lets `emitOrderEvent` log a failed user read. */
const inBackground = (task: Promise<void>): Promise<void> => {
  if (process.env.VERCEL) waitUntil(task);
  return task;
};

const recipient = (userId: string) =>
  prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, firstName: true, preferredLocale: true },
  });

async function sendOrderPlaced(order: Order): Promise<void> {
  const user = await recipient(order.userId);
  if (!user) return; // user deleted meanwhile: nothing to send
  await mailer.sendInBackground({
    to: user.email,
    template: 'order-placed',
    locale: user.preferredLocale,
    data: {
      firstName: user.firstName,
      orderNo: order.orderNo,
      items: order.items.map((i) => ({
        title: i.titleSnapshot,
        qty: i.qty,
        unitPrice: i.unitPrice,
      })),
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      vatAmount: order.vat.vatAmount,
      total: order.total,
    },
  });
}

async function sendOrderStatus(order: Order): Promise<void> {
  const user = await recipient(order.userId);
  if (!user) return;
  await mailer.sendInBackground({
    to: user.email,
    template: 'order-status',
    locale: user.preferredLocale,
    data: { firstName: user.firstName, orderNo: order.orderNo, status: order.status },
  });
}

let registered = false;

/** Idempotent: `createApp` may run many times (tests), the consumers subscribe once per process. */
export function registerOrderEmailConsumers(): void {
  if (registered) return;
  registered = true;
  onOrderEvent('order.created', (e) => inBackground(sendOrderPlaced(e.order)));
  onOrderEvent('order.statusChanged', (e) => inBackground(sendOrderStatus(e.order)));
}
