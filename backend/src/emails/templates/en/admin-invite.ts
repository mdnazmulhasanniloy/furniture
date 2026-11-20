import { escapeHtml, layout, otpBox, formatMinutes, BRAND } from '../../layout.js';
import type { AdminInviteEmailData, TemplateFn } from '../../types.js';

export const adminInvite: TemplateFn<AdminInviteEmailData> = (d) => {
  const subject = `You have been invited to the ${BRAND} admin`;
  const mins = formatMinutes(d.ttlSeconds, 'en');
  const url = escapeHtml(d.adminUrl);
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>You have been invited as an administrator. Open the admin panel and enter this code to verify your email and set up your account:</p>
${otpBox(d.code)}
<p><a href="${url}">${url}</a></p>
<p>The code is valid for ${mins}.</p>`;
  const text = `Hi ${d.firstName},\n\nYou have been invited as an administrator.\nAdmin panel: ${d.adminUrl}\nYour verification code: ${d.code} (valid for ${mins}).`;
  return layout('en', subject, html, text);
};
