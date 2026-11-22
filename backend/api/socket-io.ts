import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { getEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { ensureSocketIndexes } from '../src/lib/mongo.js';
import { initSentry } from '../src/lib/sentry.js';
import { createSocketServer } from '../src/lib/socketServer.js';

initSentry(getEnv());

let attachedTo: HttpServer | undefined;

/**
 * Vercel socket function (ADR-012 §1): one Socket.IO server per instance, attached to the runtime's
 * Node server so engine.io owns the websocket upgrades for `SOCKET_PATH`. WebSocket support and the
 * function duration limit are stated platform facts that T-026 verifies on a real preview deploy
 * (clients reconnect + re-fetch on the planned close, so the limit is invisible to users).
 */
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  const env = getEnv();
  const server = (res.socket as { server?: HttpServer } | null)?.server;
  if (server && server !== attachedTo) {
    createSocketServer(server, env);
    ensureSocketIndexes().catch((err: unknown) => {
      // Not fatal: the memo is cleared on failure, so the next invocation retries.
      createLogger(env).error({ err }, 'socket TTL index creation failed');
    });
    attachedTo = server;
  }
  // A plain HTTP request (health probe / misconfigured client): sockets are websocket-only (ADR-012).
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, transport: 'websocket-only' }));
}
