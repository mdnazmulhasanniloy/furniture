import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { OtpEmailData, TemplateFn } from '../../types.js';

export const otpReset: TemplateFn<OtpEmailData> = (d) => {
  const subject = `Reset your ${BRAND} password`;
  const mins = formatMinutes(d.ttlSeconds, 'en');
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>Use this code to reset your password:</p>
${otpBox(d.code)}
<p>The code is valid for ${mins}. If you did not request a reset, you can ignore this email; your password will not change.</p>`;
  const text = `Hi ${d.firstName},\n\nYour password reset code is ${d.code}. It is valid for ${mins}.\nIf you did not request a reset, ignore this email.`;
  return layout('en', subject, html, text);
};
