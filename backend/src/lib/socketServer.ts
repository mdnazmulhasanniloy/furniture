import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/mongo-adapter';
import { Server, type Socket } from 'socket.io';
import type { Env } from '../config/env.js';
import { createLogger, type Logger } from './logger.js';
import { adapterCollection } from './mongo.js';
import { prisma } from './prisma.js';
import { hit, limitKey } from './rateLimit.js';
import { verifyAccessToken } from './tokens.js';

/**
 * Socket.IO server on the MongoDB adapter (ADR-012, T-023; `integrations.md#socketio-on-vercel`).
 * Used by both the dev entry (`src/server.ts`) and the Vercel socket function (`api/socket-io.ts`).
 */

/**
 * Vercel routes ONLY the exact function path `/api/socket-io` to `api/socket-io.ts` — sub-paths
 * such as `/api/socket-io/socket.io/` get the platform's 404 (verified on the deployed preview,
 * 2026-11-23). Socket.IO therefore serves the function path itself, with `addTrailingSlash: false`
 * so engine.io requests are `/api/socket-io?EIO=…`, never `/api/socket-io/?EIO=…`.
 */
export const SOCKET_PATH = '/api/socket-io';
/** NFR-01: connection attempts per IP (counted before auth, shared across instances via T-024). */
export const SOCKET_CONNECT_LIMIT = 30;
export const SOCKET_CONNECT_WINDOW_SECONDS = 60;
/** Clients only listen (NOTIF-01..03), so inbound frames never need more than this. */
export const SOCKET_MAX_BUFFER_BYTES = 10 * 1024;

/**
 * Node keeps a timer delay in a 32-bit signed integer. A larger delay is silently clamped to 1 ms
 * (with a `TimeoutOverflowWarning`), so an access-token TTL beyond ~24.8 days used to fire the
 * expiry disconnect *immediately* instead of at expiry — inverting the control it implements and
 * killing every socket on connect. Long waits are served in slices instead (`armExpiryTimer`).
 */
export const MAX_TIMEOUT_MS = 2_147_483_647;

export interface CancellableTimer {
  cancel(): void;
}

/**
 * `setTimeout` for an arbitrarily distant deadline: the wait is split into slices no longer than
 * `MAX_TIMEOUT_MS` and re-armed until the remainder is gone. A deadline already in the past fires
 * on the next tick, exactly as `setTimeout(fn, 0)` would (T-023, NOTIF-01).
 */
export function armExpiryTimer(onExpiry: () => void, delayMs: number): CancellableTimer {
  let remaining = Number.isFinite(delayMs) ? Math.max(delayMs, 0) : 0;
  let timer: NodeJS.Timeout;
  const arm = (): void => {
    const slice = Math.min(remaining, MAX_TIMEOUT_MS);
    remaining -= slice;
    timer = setTimeout(() => (remaining > 0 ? arm() : onExpiry()), slice);
  };
  arm();
  return {
    cancel: () => clearTimeout(timer),
  };
}

/** Mirrors `req.ip`: the forwarded header counts only when the proxy is trusted (`TRUST_PROXY`). */
function clientIp(socket: Socket, env: Env): string | undefined {
  if (env.TRUST_PROXY !== false) {
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return socket.handshake.address;
}

export function createSocketServer(
  httpServer: HttpServer,
  env: Env,
  opts: { logger?: Logger } = {},
): Server {
  const log = opts.logger ?? createLogger(env);
  const allowedOrigin = (origin: string | undefined) =>
    !origin || env.CORS_ALLOWED_ORIGINS.includes(origin);
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    maxHttpBufferSize: SOCKET_MAX_BUFFER_BYTES,
    cors: {
      credentials: true,
      origin: (origin, cb) => cb(null, allowedOrigin(origin)),
    },
    // The `cors` option only guards polling requests; a websocket upgrade bypasses it, so the same
    // allow-list runs here too (no Origin header = non-browser client, allowed — same rule as app.ts).
    allowRequest: (req, cb) => cb(null, allowedOrigin(req.headers.origin)),
  });

  io.adapter(createAdapter(adapterCollection(), { addCreatedAtField: true }));

  io.use(async (socket, next) => {
    const res = await hit(
      limitKey('socket', 'ip', clientIp(socket, env)),
      SOCKET_CONNECT_LIMIT,
      SOCKET_CONNECT_WINDOW_SECONDS,
      { log },
    );
    next(res.allowed ? undefined : new Error('rate_limited'));
  });

  // Socket auth = HTTP auth (AUTH-06 rules, same as `authenticateBearer`): verify the JWT, then load the
  // user from the DB — reject when missing, blocked, unverified or the token predates a password reset;
  // rooms are joined with the DB role, never the token's. Every failure is the same `unauthorized`.
  io.use(async (socket, next) => {
    try {
      const token: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
      if (typeof token !== 'string' || token === '') throw new Error('missing token');
      const claims = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user || user.isBlocked || !user.isVerified) throw new Error('rejected');
      if (
        user.passwordChangedAt &&
        claims.iat <= Math.floor(user.passwordChangedAt.getTime() / 1000)
      ) {
        throw new Error('rejected');
      }
      socket.data.userId = user.id;
      await socket.join(`user:${user.id}`);
      if (user.role === 'ADMIN') await socket.join('admins');
      // The socket must not outlive its credential: disconnect when the access token expires.
      // Re-armed in slices, because a TTL past Node's 32-bit timer ceiling would otherwise be
      // clamped to 1 ms and disconnect the socket straight away (`armExpiryTimer`).
      const timer = armExpiryTimer(() => socket.disconnect(true), claims.exp * 1000 - Date.now());
      socket.on('disconnect', () => timer.cancel());
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  // No client→server event handlers are registered on purpose: clients only listen (NOTIF-01..03).
  // Anything a client emits is ignored by Socket.IO (no handler, no ack) and never reaches the app.

  return io;
}
