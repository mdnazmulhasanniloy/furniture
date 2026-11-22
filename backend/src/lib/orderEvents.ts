import type { Order } from '@prisma/client';
import { getEnv } from '../config/env.js';
import { createLogger, type Logger } from './logger.js';

/**
 * In-process order events (T-013). Emitted strictly AFTER the placement/update transaction has
 * committed — a consumer must never observe an order that may still roll back. Consumers (order
 * emails T-014, notifications T-016) subscribe here and, on Vercel, run their work inside
 * `waitUntil` so the response is never delayed or failed by them.
 */

export type OrderEventName = 'order.created' | 'order.statusChanged';

export interface OrderEvent {
  name: OrderEventName;
  order: Order;
}

type Handler = (event: OrderEvent) => void | Promise<void>;

const handlers = new Map<OrderEventName, Set<Handler>>();

let fallbackLogger: Logger | undefined;
const log = (): Pick<Logger, 'error'> => (fallbackLogger ??= createLogger(getEnv()));

/** Subscribe to an order event. Returns an unsubscribe function (used by tests). */
export function onOrderEvent(name: OrderEventName, handler: Handler): () => void {
  const set = handlers.get(name) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(name, set);
  return () => {
    set.delete(handler);
  };
}

/**
 * Fire an event. Handler failures are logged and never propagate: the order is already committed,
 * so the request must succeed regardless of what a consumer does.
 */
export function emitOrderEvent(
  name: OrderEventName,
  order: Order,
  ctx: { log?: Pick<Logger, 'error'>; requestId?: string } = {},
): void {
  for (const handler of handlers.get(name) ?? []) {
    try {
      void Promise.resolve(handler({ name, order })).catch((err: unknown) => {
        (ctx.log ?? log()).error(
          { err, requestId: ctx.requestId, event: name, orderId: order.id },
          'order event handler failed',
        );
      });
    } catch (err) {
      (ctx.log ?? log()).error(
        { err, requestId: ctx.requestId, event: name, orderId: order.id },
        'order event handler failed',
      );
    }
  }
}
