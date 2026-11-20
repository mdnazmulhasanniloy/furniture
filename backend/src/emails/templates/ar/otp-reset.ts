import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { OtpEmailData, TemplateFn } from '../../types.js';

export const otpReset: TemplateFn<OtpEmailData> = (d) => {
  const subject = `إعادة تعيين كلمة المرور في ${BRAND}`;
  const mins = formatMinutes(d.ttlSeconds, 'ar');
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>استخدم هذا الرمز لإعادة تعيين كلمة المرور:</p>
${otpBox(d.code)}
<p>الرمز صالح لمدة ${mins}. إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة ولن تتغير كلمة المرور.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nرمز إعادة تعيين كلمة المرور هو ${d.code}. الرمز صالح لمدة ${mins}.\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.`;
  return layout('ar', subject, html, text);
};
