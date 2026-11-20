import { escapeHtml, formatMoney, layout, BRAND } from '../../layout.js';
import type { OrderPlacedEmailData, TemplateFn } from '../../types.js';

export const orderPlaced: TemplateFn<OrderPlacedEmailData> = (d) => {
  const subject = `تم استلام طلبك ${d.orderNo} في ${BRAND}`;
  const m = (n: number) => formatMoney(n, 'ar');
  const rows = d.items
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.title.ar)} × ${i.qty}</td><td style="text-align:left">${m(i.unitPrice * i.qty)}</td></tr>`,
    )
    .join('\n');
  const vat =
    d.vatAmount > 0
      ? `<tr><td>ضريبة القيمة المضافة</td><td style="text-align:left">${m(d.vatAmount)}</td></tr>`
      : '';
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>شكراً لك! استلمنا طلبك رقم <strong>${escapeHtml(d.orderNo)}</strong>. الدفع عند الاستلام.</p>
<table width="100%" cellpadding="4" style="border-collapse:collapse">
${rows}
<tr><td>المجموع الفرعي</td><td style="text-align:left">${m(d.subtotal)}</td></tr>
<tr><td>التوصيل</td><td style="text-align:left">${m(d.deliveryFee)}</td></tr>
${vat}
<tr><td><strong>الإجمالي</strong></td><td style="text-align:left"><strong>${m(d.total)}</strong></td></tr>
</table>`;
  const lines = d.items.map((i) => `- ${i.title.ar} × ${i.qty}: ${m(i.unitPrice * i.qty)}`);
  const text = [
    `مرحباً ${d.firstName}،`,
    `استلمنا طلبك رقم ${d.orderNo}. الدفع عند الاستلام.`,
    ...lines,
    `المجموع الفرعي: ${m(d.subtotal)}`,
    `التوصيل: ${m(d.deliveryFee)}`,
    ...(d.vatAmount > 0 ? [`ضريبة القيمة المضافة: ${m(d.vatAmount)}`] : []),
    `الإجمالي: ${m(d.total)}`,
  ].join('\n');
  return layout('ar', subject, html, text);
};
