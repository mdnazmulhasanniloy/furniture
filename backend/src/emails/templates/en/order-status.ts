import { escapeHtml, layout, BRAND } from '../../layout.js';
import type { OrderStatusEmailData, OrderStatusName, TemplateFn } from '../../types.js';

export const STATUS_LABEL_EN: Record<OrderStatusName, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const orderStatus: TemplateFn<OrderStatusEmailData> = (d) => {
  const label = STATUS_LABEL_EN[d.status];
  const subject = `${BRAND} order ${d.orderNo}: ${label}`;
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>The status of your order <strong>${escapeHtml(d.orderNo)}</strong> is now <strong>${label}</strong>.</p>`;
  const text = `Hi ${d.firstName},\n\nThe status of your order ${d.orderNo} is now ${label}.`;
  return layout('en', subject, html, text);
};
