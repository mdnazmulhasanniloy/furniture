export type Locale = 'en' | 'ar';
export const DEFAULT_LOCALE: Locale = 'ar';

export interface LocalizedText {
  en: string;
  ar: string;
}

export type OrderStatusName =
  'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export interface OtpEmailData {
  firstName: string;
  code: string;
  /** `OTP_TTL_SECONDS`; rendered as whole minutes (rounded up). */
  ttlSeconds: number;
}

export interface OrderItemEmailData {
  title: LocalizedText;
  qty: number;
  /** halalas */
  unitPrice: number;
}

export interface OrderPlacedEmailData {
  firstName: string;
  orderNo: string;
  items: OrderItemEmailData[];
  /** all money in halalas */
  subtotal: number;
  deliveryFee: number;
  vatAmount: number;
  total: number;
}

export interface OrderStatusEmailData {
  firstName: string;
  orderNo: string;
  status: OrderStatusName;
}

export interface PasswordChangedEmailData {
  firstName: string;
}

/** T-108: the security email after a password change. Never carries a secret of any kind. */
export interface AdminPasswordChangedEmailData {
  firstName: string;
  /** When the change happened; rendered in Asia/Riyadh. */
  at: Date | string;
}

export interface AdminInviteEmailData {
  firstName: string;
  code: string;
  ttlSeconds: number;
  /** `ADMIN_URL` */
  adminUrl: string;
}

export interface TemplateDataMap {
  'otp-verify': OtpEmailData;
  'otp-reset': OtpEmailData;
  'password-changed': PasswordChangedEmailData;
  'admin-password-changed': AdminPasswordChangedEmailData;
  'order-placed': OrderPlacedEmailData;
  'order-status': OrderStatusEmailData;
  'admin-invite': AdminInviteEmailData;
}

export type TemplateName = keyof TemplateDataMap;
export const TEMPLATE_NAMES: TemplateName[] = [
  'otp-verify',
  'otp-reset',
  'password-changed',
  'admin-password-changed',
  'order-placed',
  'order-status',
  'admin-invite',
];

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export type TemplateFn<T> = (data: T) => RenderedEmail;
