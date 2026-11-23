import { createServer } from 'node:http';
import { getEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { ensureSocketIndexes } from '../src/lib/mongo.js';
import { initSentry } from '../src/lib/sentry.js';
import { createSocketServer } from '../src/lib/socketServer.js';
import { restoreOriginalUrl } from '../src/lib/vercelUrl.js';

const env = getEnv();
initSentry(env);

/**
 * Vercel socket function (ADR-012 §1, amended 2026-11-23): the official Vercel WebSocket shape —
 * default-export an http.Server with Socket.IO attached, and let the platform route
 * `/api/socket-io/*` (including the websocket upgrade) to it (vercel.com/docs/functions/websockets).
 * No vercel.json rewrite may touch this path: upgrade requests pass through rewrites BEFORE the
 * upgrade (same doc), so a rewrite moves the URL away from `SOCKET_PATH` and engine.io never
 * answers 101. The request listener below only serves non-socket paths (health probes,
 * misconfigured clients): engine.io wraps it on attach and owns `SOCKET_PATH`.
 */
const server = createServer((_req, res) => {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, transport: 'websocket-only' }));
});

// Defensive only: should routing ever deliver an upgrade with the rewrite-destination URL
// (`/api/socket-io?__originalPath=…`), restore it. Registered before engine.io's upgrade listener;
// a no-op for normal upgrade URLs.
server.on('upgrade', (req) => restoreOriginalUrl(req, '/api/socket-io'));

/** Exported for tests; Vercel only uses the default export. */
export const io = createSocketServer(server, env);

ensureSocketIndexes().catch((err: unknown) => {
  // Not fatal: the memo is cleared on failure, so the next call retries.
  createLogger(env).error({ err }, 'socket TTL index creation failed');
});

export default server;
