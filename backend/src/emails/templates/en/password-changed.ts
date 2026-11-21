import { escapeHtml, layout, BRAND } from '../../layout.js';
import type { PasswordChangedEmailData, TemplateFn } from '../../types.js';

export const passwordChanged: TemplateFn<PasswordChangedEmailData> = (d) => {
  const subject = `Your ${BRAND} password was changed`;
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>The password of your ${BRAND} account was just changed.</p>
<p>If this was not you, please contact support right away.</p>`;
  const text = `Hi ${d.firstName},\n\nThe password of your ${BRAND} account was just changed.\nIf this was not you, please contact support right away.`;
  return layout('en', subject, html, text);
};
