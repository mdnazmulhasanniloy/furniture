import { escapeHtml, formatRiyadhDateTime, layout, BRAND } from '../../layout.js';
import type { AdminPasswordChangedEmailData, TemplateFn } from '../../types.js';

/**
 * T-108 (owner copy, approved 2026-11-25). The security email an admin gets after their own password
 * was changed. The time is in Asia/Riyadh; nothing else is in here - no password, token, code, link,
 * IP address or device.
 */
export const adminPasswordChanged: TemplateFn<AdminPasswordChangedEmailData> = (d) => {
  const subject = `تم تغيير كلمة مرور حساب الإدارة في ${BRAND}`;
  const at = formatRiyadhDateTime(d.at, 'ar');
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>تم تغيير كلمة مرور حسابك الإداري في ${BRAND}. إذا لم تكن أنت من قام بذلك، تواصل مع مالك المتجر فوراً.</p>
<p>الوقت: ${escapeHtml(at)} (الرياض)</p>`;
  const text = `مرحباً ${d.firstName}،\n\nتم تغيير كلمة مرور حسابك الإداري في ${BRAND}. إذا لم تكن أنت من قام بذلك، تواصل مع مالك المتجر فوراً.\n\nالوقت: ${at} (الرياض)`;
  return layout('ar', subject, html, text);
};
