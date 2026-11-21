import type { Role, User } from '@prisma/client';
import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { verifyAccessToken } from '../lib/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuth`: the user as loaded from the database for this request. */
    user?: User;
  }
}

/**
 * AUTH-06. Verifies the Bearer access token, then loads the user from the DB on EVERY request:
 * 401 if the user is gone, blocked or unverified; `role` always comes from the DB, never from the token.
 */
export async function authenticateBearer(req: Request): Promise<User> {
  const header = req.get('authorization');
  const match = header ? /^Bearer (\S+)$/i.exec(header) : null;
  if (!match) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  const claims = verifyAccessToken(match[1]!);
  const user = await prisma.user.findUnique({ where: { id: claims.sub } });
  if (!user || user.isBlocked || !user.isVerified) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  // AUTH-03: a password reset invalidates access tokens issued before it (`iat` has 1 s precision).
  if (user.passwordChangedAt && claims.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return user;
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  req.user = await authenticateBearer(req);
  next();
};

/** Use after `requireAuth`. The role is the one stored in the database. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    if (!roles.includes(req.user.role)) throw new AppError(403, 'FORBIDDEN', 'Insufficient role');
    next();
  };
