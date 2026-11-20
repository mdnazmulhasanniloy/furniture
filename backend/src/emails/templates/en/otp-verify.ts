import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { OtpEmailData, TemplateFn } from '../../types.js';

export const otpVerify: TemplateFn<OtpEmailData> = (d) => {
  const subject = `Your ${BRAND} verification code`;
  const mins = formatMinutes(d.ttlSeconds, 'en');
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>Use this code to verify your email address:</p>
${otpBox(d.code)}
<p>The code is valid for ${mins}. If you did not create an account, ignore this email.</p>`;
  const text = `Hi ${d.firstName},\n\nYour verification code is ${d.code}. It is valid for ${mins}.\nIf you did not create an account, ignore this email.`;
  return layout('en', subject, html, text);
};
