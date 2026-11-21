import type { Request, RequestHandler } from 'express';
import { parseAcceptLanguage } from '../../lib/locale.js';
import { clearRefreshCookie, setRefreshCookie } from '../../lib/tokens.js';
import * as auth from './auth.service.js';
import * as session from './session.service.js';
import type { RegisterBody, ResendOtpBody } from './schema.js';

const locale = (req: Request) => parseAcceptLanguage(req.get('accept-language'));
const MESSAGES = {
  registered: {
    en: 'A verification code was sent to your email',
    ar: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني',
  },
  resent: {
    en: 'If the account exists, a new code was sent',
    ar: 'إذا كان الحساب موجوداً، فقد تم إرسال رمز جديد',
  },
};
const msg = (key: keyof typeof MESSAGES, req: Request) => MESSAGES[key][locale(req) ?? 'ar'];

export const register: RequestHandler = async (req, res) => {
  await auth.register(req.body as RegisterBody, locale(req));
  res.status(201).json({ message: msg('registered', req) });
};

export const verifyOtp: RequestHandler = async (req, res) => {
  const { email, code } = req.body as { email: string; code: string };
  const { user, accessToken, refreshToken } = await auth.verifyOtp(
    email,
    code,
    req.get('user-agent'),
  );
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken, user: auth.toPublicUser(user) });
};

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const { user, accessToken, refreshToken } = await session.login(email, password, {
    userAgent: req.get('user-agent'),
    requestId: req.id,
    locale: locale(req),
  });
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken, user: auth.toPublicUser(user) });
};

export const csrf: RequestHandler = async (req, res) => {
  res.status(200).json({ csrfToken: await session.issueCsrf(req) });
};

export const refresh: RequestHandler = async (req, res) => {
  const { user, accessToken, refreshToken } = await session.refresh(req);
  setRefreshCookie(res, refreshToken);
  res.status(200).json({ accessToken, user: auth.toPublicUser(user) });
};

export const logout: RequestHandler = async (req, res) => {
  await session.logout(req);
  clearRefreshCookie(res);
  res.status(204).end();
};

export const me: RequestHandler = (req, res) => {
  res.status(200).json(auth.toPublicUser(req.user!));
};

export const resendOtp: RequestHandler = async (req, res) => {
  const { email, purpose, password } = req.body as ResendOtpBody;
  await auth.resendOtp(email, purpose, password, locale(req));
  res.status(200).json({ message: msg('resent', req) });
};
