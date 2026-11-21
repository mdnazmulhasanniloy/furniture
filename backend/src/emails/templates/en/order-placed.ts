import { escapeHtml, formatMoney, layout, BRAND } from '../../layout.js';
import type { OrderPlacedEmailData, TemplateFn } from '../../types.js';

export const orderPlaced: TemplateFn<OrderPlacedEmailData> = (d) => {
  const subject = `${BRAND} order ${d.orderNo} received`;
  const m = (n: number) => formatMoney(n, 'en');
  const rows = d.items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.title.en)} × ${i.qty}</td><td style="text-align:right">${m(i.unitPrice * i.qty)}</td></tr>`,
    )
    .join('\n');
  const vat =
    d.vatAmount > 0
      ? `<tr><td>VAT</td><td style="text-align:right">${m(d.vatAmount)}</td></tr>`
      : '';
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>Thank you! We received your order <strong>${escapeHtml(d.orderNo)}</strong>. Payment is cash on delivery.</p>
<table width="100%" cellpadding="4" style="border-collapse:collapse">
${rows}
<tr><td>Subtotal</td><td style="text-align:right">${m(d.subtotal)}</td></tr>
<tr><td>Delivery</td><td style="text-align:right">${m(d.deliveryFee)}</td></tr>
${vat}
<tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${m(d.total)}</strong></td></tr>
</table>`;
  const lines = d.items.map((i) => `- ${i.title.en} × ${i.qty}: ${m(i.unitPrice * i.qty)}`);
  const text = [
    `Hi ${d.firstName},`,
    `We received your order ${d.orderNo}. Payment is cash on delivery.`,
    ...lines,
    `Subtotal: ${m(d.subtotal)}`,
    `Delivery: ${m(d.deliveryFee)}`,
    ...(d.vatAmount > 0 ? [`VAT: ${m(d.vatAmount)}`] : []),
    `Total: ${m(d.total)}`,
  ].join('\n');
  return layout('en', subject, html, text);
};
