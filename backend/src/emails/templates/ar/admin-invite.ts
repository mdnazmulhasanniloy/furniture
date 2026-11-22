import { escapeHtml, layout, otpBox, formatDuration, BRAND } from '../../layout.js';
import type { AdminInviteEmailData, TemplateFn } from '../../types.js';

export const adminInvite: TemplateFn<AdminInviteEmailData> = (d) => {
  const subject = `تمت دعوتك إلى لوحة إدارة ${BRAND}`;
  const validity = formatDuration(d.ttlSeconds, 'ar');
  const url = escapeHtml(d.adminUrl);
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>تمت دعوتك كمسؤول. افتح الرابط أدناه وأدخل هذا الرمز مع كلمة مرور من اختيارك لتفعيل حسابك:</p>
${otpBox(d.code)}
<p><a href="${url}">${url}</a></p>
<p>الرمز صالح لمدة ${validity}.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nتمت دعوتك كمسؤول.\nفعّل حسابك: ${d.adminUrl}\nرمز الدعوة: ${d.code} (صالح لمدة ${validity}).`;
  return layout('ar', subject, html, text);
};
