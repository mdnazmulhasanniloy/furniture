import { escapeHtml, layout, BRAND } from '../../layout.js';
import type { OrderStatusEmailData, OrderStatusName, TemplateFn } from '../../types.js';

export const STATUS_LABEL_AR: Record<OrderStatusName, string> = {
  PENDING: 'قيد الانتظار',
  CONFIRMED: 'تم التأكيد',
  PROCESSING: 'قيد التجهيز',
  OUT_FOR_DELIVERY: 'في الطريق إليك',
  DELIVERED: 'تم التسليم',
  CANCELLED: 'ملغي',
};

export const orderStatus: TemplateFn<OrderStatusEmailData> = (d) => {
  const label = STATUS_LABEL_AR[d.status];
  const subject = `طلبك ${d.orderNo} في ${BRAND}: ${label}`;
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>أصبحت حالة طلبك رقم <strong>${escapeHtml(d.orderNo)}</strong>: <strong>${label}</strong>.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nأصبحت حالة طلبك رقم ${d.orderNo}: ${label}.`;
  return layout('ar', subject, html, text);
};
