import { escapeHtml, layout, otpBox, formatDuration, BRAND } from '../../layout.js';
import type { AdminInviteEmailData, TemplateFn } from '../../types.js';

export const adminInvite: TemplateFn<AdminInviteEmailData> = (d) => {
  const subject = `You have been invited to the ${BRAND} admin`;
  const validity = formatDuration(d.ttlSeconds, 'en');
  const url = escapeHtml(d.adminUrl);
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>You have been invited as an administrator. Open the link below and enter this code together with a password of your choice to activate your account:</p>
${otpBox(d.code)}
<p><a href="${url}">${url}</a></p>
<p>The code is valid for ${validity}.</p>`;
  const text = `Hi ${d.firstName},\n\nYou have been invited as an administrator.\nActivate your account: ${d.adminUrl}\nYour invitation code: ${d.code} (valid for ${validity}).`;
  return layout('en', subject, html, text);
};
