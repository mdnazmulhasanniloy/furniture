import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { OtpEmailData, TemplateFn } from '../../types.js';

export const otpVerify: TemplateFn<OtpEmailData> = (d) => {
  const subject = `رمز التحقق الخاص بك في ${BRAND}`;
  const mins = formatMinutes(d.ttlSeconds, 'ar');
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>استخدم هذا الرمز لتأكيد بريدك الإلكتروني:</p>
${otpBox(d.code)}
<p>الرمز صالح لمدة ${mins}. إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nرمز التحقق الخاص بك هو ${d.code}. الرمز صالح لمدة ${mins}.\nإذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.`;
  return layout('ar', subject, html, text);
};
