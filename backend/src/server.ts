import 'dotenv/config';
import { getEnv } from './config/env.js';
import { initSentry } from './lib/sentry.js';

// Dev entry. Socket.IO is mounted here in T-023.
const env = getEnv();
initSentry(env);
const { createApp } = await import('./app.js');
const { ensureIndexes } = await import('./lib/rateLimit.js');
// Not fatal: the limiter retries lazily on first use (and fails open while MongoDB is unreachable).
await ensureIndexes().catch((err: unknown) => {
  console.error('rate limit ensureIndexes failed', err);
});
const app = createApp(env);
app.listen(env.PORT, () => {
  console.log(`Furnixa API listening on http://localhost:${env.PORT}`);
});
