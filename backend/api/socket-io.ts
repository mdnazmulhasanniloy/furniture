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
 * Vercel socket function (ADR-012 §1, amended 2026-11-23 twice): the official Vercel WebSocket
 * shape — default-export an http.Server with Socket.IO attached. Preview verification showed the
 * platform routes ONLY the exact function path `/api/socket-io` here (sub-paths like
 * `/api/socket-io/socket.io/` get the platform 404), so Socket.IO serves the function path itself:
 * `path: SOCKET_PATH` (= `/api/socket-io`) with `addTrailingSlash: false` in socketServer.ts.
 * No vercel.json rewrite may touch this path either: upgrade requests pass through rewrites BEFORE
 * the upgrade (vercel.com/docs/functions/websockets). engine.io wraps the request listener on
 * attach and owns every URL starting with `SOCKET_PATH` — a GET without an `EIO` query gets
 * engine.io's 400 `{"code":0,"message":"Transport unknown"}`, which doubles as the reachability
 * probe. The listener below only answers paths outside `SOCKET_PATH`, which Vercel never sends.
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
