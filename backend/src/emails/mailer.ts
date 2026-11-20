import { waitUntil } from '@vercel/functions';
import nodemailer, { type Transporter } from 'nodemailer';
import { getEnv } from '../config/env.js';
import { createLogger } from '../lib/logger.js';
import { renderEmail, resolveLocale } from './render.js';
import type { TemplateDataMap, TemplateName } from './types.js';

export interface SendArgs<K extends TemplateName = TemplateName> {
  to: string;
  template: K;
  /** Recipient's `preferredLocale`; falls back to `ar` when missing. */
  locale?: string | null;
  data: TemplateDataMap[K];
}

let transport: Transporter | undefined;
let logger: ReturnType<typeof createLogger> | undefined;

const log = () => (logger ??= createLogger(getEnv()));

/** Test hook: inject a transport (e.g. nodemailer `jsonTransport`); `undefined` resets. */
export function setTransport(t: Transporter | undefined): void {
  transport = t;
}

function getTransport(): Transporter {
  if (transport) return transport;
  const env = getEnv();
  if (!env.SMTP_HOST) throw new Error('SMTP_HOST is not configured');
  const auth = env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } : undefined;
  return (transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth,
  }));
}

/** Awaited send: rejects when the transport fails (used for OTP emails). */
export async function send<K extends TemplateName>(args: SendArgs<K>): Promise<void> {
  const locale = resolveLocale(args.locale);
  const { subject, html, text } = renderEmail(args.template, locale, args.data);
  const env = getEnv();
  await getTransport().sendMail({ from: env.MAIL_FROM, to: args.to, subject, html, text });
}

/**
 * Non-blocking send for order emails. The promise never rejects (failures are logged without the
 * message data). On Vercel it is registered with `waitUntil` so the function is not frozen before
 * the mail leaves; elsewhere it is plain fire-and-forget.
 */
export function sendInBackground<K extends TemplateName>(args: SendArgs<K>): Promise<void> {
  const task = send(args).catch((err: unknown) => {
    log().error({ err, template: args.template }, 'background email failed');
  });
  if (process.env.VERCEL) waitUntil(task);
  return task;
}

export const mailer = { send, sendInBackground };
