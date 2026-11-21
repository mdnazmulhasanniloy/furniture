import { escapeHtml, layout, BRAND } from '../../layout.js';
import type { PasswordChangedEmailData, TemplateFn } from '../../types.js';

export const passwordChanged: TemplateFn<PasswordChangedEmailData> = (d) => {
  const subject = `تم تغيير كلمة المرور في ${BRAND}`;
  const html = `<p>مرحباً ${escapeHtml(d.firstName)}،</p>
<p>تم تغيير كلمة مرور حسابك في ${BRAND} للتو.</p>
<p>إذا لم تكن أنت من قام بذلك، يرجى التواصل مع الدعم فوراً.</p>`;
  const text = `مرحباً ${d.firstName}،\n\nتم تغيير كلمة مرور حسابك في ${BRAND} للتو.\nإذا لم تكن أنت من قام بذلك، يرجى التواصل مع الدعم فوراً.`;
  return layout('ar', subject, html, text);
};
