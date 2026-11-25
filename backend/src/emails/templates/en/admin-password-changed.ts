import { escapeHtml, formatRiyadhDateTime, layout, BRAND } from '../../layout.js';
import type { AdminPasswordChangedEmailData, TemplateFn } from '../../types.js';

/**
 * T-108 (owner copy, approved 2026-11-25). The security email an admin gets after their own password
 * was changed. The time is in Asia/Riyadh; nothing else is in here - no password, token, code, link,
 * IP address or device.
 */
export const adminPasswordChanged: TemplateFn<AdminPasswordChangedEmailData> = (d) => {
  const subject = `Your ${BRAND} admin password was changed`;
  const at = formatRiyadhDateTime(d.at, 'en');
  const html = `<p>Hi ${escapeHtml(d.firstName)},</p>
<p>Your ${BRAND} admin password was changed. If this wasn't you, contact the store owner right away.</p>
<p>When: ${escapeHtml(at)} (Riyadh)</p>`;
  const text = `Hi ${d.firstName},\n\nYour ${BRAND} admin password was changed. If this wasn't you, contact the store owner right away.\n\nWhen: ${at} (Riyadh)`;
  return layout('en', subject, html, text);
};
