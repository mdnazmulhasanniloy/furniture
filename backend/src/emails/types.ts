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
  'order-placed': OrderPlacedEmailData;
  'order-status': OrderStatusEmailData;
  'admin-invite': AdminInviteEmailData;
}

export type TemplateName = keyof TemplateDataMap;
export const TEMPLATE_NAMES: TemplateName[] = [
  'otp-verify',
  'otp-reset',
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
