import 'dotenv/config';
import { createServer } from 'node:http';
import { getEnv } from './config/env.js';
import { initSentry } from './lib/sentry.js';

// Dev entry (ADR-012 §1): one Node process serves the API and Socket.IO on the same port.
const env = getEnv();
initSentry(env);
const { createApp } = await import('./app.js');
const { ensureIndexes } = await import('./lib/rateLimit.js');
const { ensureSocketIndexes } = await import('./lib/mongo.js');
const { createSocketServer } = await import('./lib/socketServer.js');
// Not fatal: the limiter retries lazily on first use (and fails open while MongoDB is unreachable).
await ensureIndexes().catch((err: unknown) => {
  console.error('rate limit ensureIndexes failed', err);
});
// Not fatal either: the memo is cleared on failure and retried on the next ensure call.
await ensureSocketIndexes().catch((err: unknown) => {
  console.error('socket adapter ensureSocketIndexes failed', err);
});
const app = createApp(env);
const httpServer = createServer(app);
createSocketServer(httpServer, env);
httpServer.listen(env.PORT, () => {
  console.log(`Furnixa API + Socket.IO listening on http://localhost:${env.PORT}`);
});
