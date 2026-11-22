import type { NotificationType, Order, Prisma } from '@prisma/client';
import { waitUntil } from '@vercel/functions';
import { STATUS_LABEL_AR } from '../../emails/templates/ar/order-status.js';
import { STATUS_LABEL_EN } from '../../emails/templates/en/order-status.js';
import { socketEmitter } from '../../lib/emitter.js';
import { onOrderEvent, type OrderStatusChange } from '../../lib/orderEvents.js';
import { prisma } from '../../lib/prisma.js';
import { toNotification } from './service.js';

/**
 * NOTIF-01/02 + ADM-10 (T-016): order-event consumers. The events fire strictly after commit
 * (T-013); on Vercel the WHOLE handler runs inside `waitUntil` (same pattern as the T-014 email
 * consumers). Contract (integrations.md, owner 2026-11-22): every Notification row is written (and
 * awaited) BEFORE its emit — the row is the source of truth; `notification:new` goes to each
 * recipient's own `user:{id}` room carrying THAT user's serialized row, id included. Emit failures
 * are logged (`emitOrderEvent` / the guarded emitter collection) and never fail the request.
 */

const inBackground = (task: Promise<void>): Promise<void> => {
  if (process.env.VERCEL) waitUntil(task);
  return task;
};

interface Content {
  type: NotificationType;
  title: { en: string; ar: string };
  body: { en: string; ar: string };
  link: string;
  data: Prisma.InputJsonValue;
}

/** `link` is a logical path; `data` is the authoritative navigation payload (api-spec.yaml). */
const orderContent = (order: Order) => ({
  link: `/orders/${order.id}`,
  data: { orderId: order.id, orderNo: order.orderNo, status: order.status },
});

/** Row first, emit second (the contract above). Rule 8: optional fields written as explicit null. */
async function notify(userId: string, content: Content): Promise<void> {
  const row = await prisma.notification.create({
    data: { userId, ...content, readAt: null },
  });
  socketEmitter.toUser(userId).emit('notification:new', toNotification(row));
}

/** NOTIF-02 / ADM-10: one row + one emit per non-blocked admin (data-model.md fan-out). */
async function fanOutToAdmins(content: Content): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isBlocked: false },
    select: { id: true },
  });
  const rows = await Promise.all(
    admins.map((a) =>
      prisma.notification.create({ data: { userId: a.id, ...content, readAt: null } }),
    ),
  );
  for (const row of rows) {
    socketEmitter.toUser(row.userId).emit('notification:new', toNotification(row));
  }
}

/** NOTIF-02: a new order notifies every admin. */
const onOrderCreated = (order: Order): Promise<void> =>
  fanOutToAdmins({
    type: 'NEW_ORDER',
    title: { en: 'New order', ar: 'طلب جديد' },
    body: {
      en: `Order ${order.orderNo} was placed.`,
      ar: `تم تقديم الطلب ${order.orderNo}.`,
    },
    ...orderContent(order),
  });

/**
 * NOTIF-01: an admin status change notifies the customer. A customer self-cancel
 * (`byUserId === order.userId`, T-015) instead notifies the admins — with the cancel reason, which
 * is admin-visible (the StatusEvent note) — and never the customer (owner 2026-11-22: a toast for
 * your own click is noise). `order:updated` is emitted to the customer's room in both cases: it is
 * state sync for an open order page, not a notification.
 */
async function onStatusChanged(order: Order, change: OrderStatusChange | undefined): Promise<void> {
  if (!change) return; // statusChanged always carries a change (orderEvents.ts); nothing to do without one
  if (change.byUserId === order.userId) {
    if (change.to === 'CANCELLED') {
      // The reason is the note of the CANCELLED StatusEvent the transition just appended.
      const reason = order.statusHistory.findLast((e) => e.status === 'CANCELLED')?.note ?? null;
      await fanOutToAdmins({
        type: 'ORDER_STATUS',
        title: { en: 'Order cancelled by customer', ar: 'ألغى العميل الطلب' },
        body: {
          en: `Customer cancelled order ${order.orderNo}.${reason ? ` Reason: ${reason}` : ''}`,
          ar: `ألغى العميل الطلب ${order.orderNo}.${reason ? ` السبب: ${reason}` : ''}`,
        },
        ...orderContent(order),
      });
    }
  } else {
    await notify(order.userId, {
      type: 'ORDER_STATUS',
      title: { en: 'Order update', ar: 'تحديث الطلب' },
      body: {
        en: `Your order ${order.orderNo} is now ${STATUS_LABEL_EN[change.to]}.`,
        ar: `أصبحت حالة طلبك ${order.orderNo}: ${STATUS_LABEL_AR[change.to]}.`,
      },
      ...orderContent(order),
    });
  }
  socketEmitter.toUser(order.userId).emit('order:updated', { id: order.id, status: order.status });
}

let registered = false;

/** Idempotent: `createApp` may run many times (tests), the consumers subscribe once per process. */
export function registerNotificationConsumers(): void {
  if (registered) return;
  registered = true;
  onOrderEvent('order.created', (e) => inBackground(onOrderCreated(e.order)));
  onOrderEvent('order.statusChanged', (e) => inBackground(onStatusChanged(e.order, e.change)));
}
