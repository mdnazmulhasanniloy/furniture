import { waitUntil } from '@vercel/functions';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mailer, sendInBackground, setTransport } from '../../src/emails/mailer.js';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

const otp = { firstName: 'Sara', code: '123456', ttlSeconds: 600 };
const json = () => nodemailer.createTransport({ jsonTransport: true });

beforeEach(() => {
  process.env.MAIL_FROM = 'Furnixa <no-reply@furnixa.test>';
});

afterEach(() => {
  setTransport(undefined);
  vi.clearAllMocks();
  delete process.env.VERCEL;
});

describe('mailer.send', () => {
  it('AUTH-01 · sends one message with from, to, subject, html and text', async () => {
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    await mailer.send({ to: 'a@b.test', template: 'otp-verify', locale: 'en', data: otp });
    expect(spy).toHaveBeenCalledOnce();
    const msg = spy.mock.calls[0]![0] as Record<string, string>;
    expect(msg.to).toBe('a@b.test');
    expect(msg.from).toBe('Furnixa <no-reply@furnixa.test>');
    expect(msg.subject).toContain('verification');
    expect(msg.html).toContain('123456');
    expect(msg.text).toContain('123456');
  });

  it('AUTH-03 · reset email is rendered with the otp-reset template', async () => {
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    await mailer.send({ to: 'a@b.test', template: 'otp-reset', locale: 'en', data: otp });
    expect((spy.mock.calls[0]![0] as Record<string, string>).subject).toContain('Reset');
  });

  it("ORD-04 · uses the recipient's preferredLocale (en and ar)", async () => {
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    const data = { firstName: 'Sara', orderNo: 'FX-1', status: 'CONFIRMED' as const };
    await mailer.send({ to: 'a@b.test', template: 'order-status', locale: 'en', data });
    await mailer.send({ to: 'a@b.test', template: 'order-status', locale: 'ar', data });
    const [en, ar] = spy.mock.calls.map((c) => c[0] as Record<string, string>);
    expect(en!.html).toContain('lang="en"');
    expect(ar!.html).toContain('dir="rtl"');
  });

  it('I18N-01 · falls back to ar when the locale is missing', async () => {
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    await mailer.send({ to: 'a@b.test', template: 'otp-verify', data: otp });
    expect((spy.mock.calls[0]![0] as Record<string, string>).html).toContain('dir="rtl"');
  });

  it('AUTH-01 · send rejects when the transport fails (OTP emails are awaited)', async () => {
    const t = json();
    vi.spyOn(t, 'sendMail').mockRejectedValue(new Error('smtp down'));
    setTransport(t);
    await expect(
      mailer.send({ to: 'a@b.test', template: 'otp-verify', locale: 'en', data: otp }),
    ).rejects.toThrow('smtp down');
  });
});

describe('sendInBackground', () => {
  it('ORD-04 · registers the promise with the waitUntil hook on Vercel', async () => {
    process.env.VERCEL = '1';
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    const p = sendInBackground({
      to: 'a@b.test',
      template: 'order-status',
      locale: 'en',
      data: { firstName: 'Sara', orderNo: 'FX-1', status: 'DELIVERED' },
    });
    expect(waitUntil).toHaveBeenCalledOnce();
    expect(vi.mocked(waitUntil).mock.calls[0]![0]).toBe(p);
    await p;
    expect(spy).toHaveBeenCalledOnce();
  });

  it('ORD-04 · outside Vercel it is plain fire-and-forget (no waitUntil)', async () => {
    const t = json();
    const spy = vi.spyOn(t, 'sendMail');
    setTransport(t);
    await sendInBackground({
      to: 'a@b.test',
      template: 'order-placed',
      locale: 'ar',
      data: {
        firstName: 'Sara',
        orderNo: 'FX-1',
        items: [],
        subtotal: 0,
        deliveryFee: 0,
        vatAmount: 0,
        total: 0,
      },
    });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('ORD-04 · a failing background send never rejects (error is logged)', async () => {
    const t = json();
    vi.spyOn(t, 'sendMail').mockRejectedValue(new Error('smtp down'));
    setTransport(t);
    await expect(
      sendInBackground({
        to: 'a@b.test',
        template: 'order-status',
        locale: 'en',
        data: { firstName: 'Sara', orderNo: 'FX-1', status: 'CONFIRMED' },
      }),
    ).resolves.toBeUndefined();
  });
});
