import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEnv } from '../../src/config/env.js';
import { send, setTransport } from '../../src/emails/mailer.js';

vi.mock('../../src/config/env.js', () => ({ getEnv: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn() } }));

const otp = { firstName: 'Sara', code: '987987', ttlSeconds: 600 };
const sendMail = vi.fn().mockResolvedValue({});

function useEnv(over: Record<string, unknown>) {
  vi.mocked(getEnv).mockReturnValue({
    NODE_ENV: 'production',
    isProduction: true,
    LOG_LEVEL: 'silent',
    SMTP_PORT: 587,
    MAIL_FROM: 'Furnixa <no-reply@furnixa.test>',
    ...over,
  } as never);
}

beforeEach(() => {
  setTransport(undefined); // force the real getTransport() path
  vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as never);
});

afterEach(() => {
  setTransport(undefined);
  vi.clearAllMocks();
});

const run = () => send({ to: 'a@b.test', template: 'otp-verify', locale: 'en', data: otp });

describe('mailer transport (getTransport)', () => {
  it('AUTH-01 · a missing SMTP_HOST in production throws and creates no transport', async () => {
    useEnv({ SMTP_HOST: undefined });
    await expect(run()).rejects.toThrow('SMTP_HOST is not configured');
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('AUTH-01 · port 465 uses secure: true, user and password are passed through', async () => {
    useEnv({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 465,
      SMTP_USER: 'me@gmail.com',
      SMTP_PASS: 'app-pass',
    });
    await run();
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'me@gmail.com', pass: 'app-pass' },
    });
    expect(sendMail).toHaveBeenCalledOnce();
  });

  it('AUTH-01 · port 587 (STARTTLS) uses secure: false', async () => {
    useEnv({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_PORT: 587,
      SMTP_USER: 'me@gmail.com',
      SMTP_PASS: 'app-pass',
    });
    await run();
    expect(vi.mocked(nodemailer.createTransport).mock.calls[0]![0]).toMatchObject({
      port: 587,
      secure: false,
      auth: { user: 'me@gmail.com', pass: 'app-pass' },
    });
  });

  it('AUTH-01 · Mailpit style config (localhost:1025, no credentials) sends without auth', async () => {
    useEnv({
      NODE_ENV: 'development',
      isProduction: false,
      SMTP_HOST: 'localhost',
      SMTP_PORT: 1025,
    });
    await run();
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined,
    });
  });

  it('AUTH-01 · the transport is created once and reused', async () => {
    useEnv({ SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'u', SMTP_PASS: 'p' });
    await run();
    await run();
    expect(nodemailer.createTransport).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledTimes(2);
  });
});
