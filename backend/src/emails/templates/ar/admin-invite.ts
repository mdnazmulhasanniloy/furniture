import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { AdminInviteEmailData, TemplateFn } from '../../types.js';

export const adminInvite: TemplateFn<AdminInviteEmailData> = (d) => {
  const subject = `تمت دعوتك إلى لوحة إدارة ${BRAND}`;
  const mins = formatMinutes(d.ttlSeconds, 'ar');
  const url = escapeHtml(d.adminUrl);
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>تمت دعوتك كمسؤول. افتح لوحة الإدارة وأدخل هذا الرمز لتأكيد بريدك الإلكتروني وإعداد حسابك:</p>
${otpBox(d.code)}
<p><a href="${url}">${url}</a></p>
<p>الرمز صالح لمدة ${mins}.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nتمت دعوتك كمسؤول.\nلوحة الإدارة: ${d.adminUrl}\nرمز التحقق: ${d.code} (صالح لمدة ${mins}).`;
  return layout('ar', subject, html, text);
};
