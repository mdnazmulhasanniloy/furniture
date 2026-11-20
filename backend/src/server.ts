import 'dotenv/config';
import { getEnv } from './config/env.js';
import { initSentry } from './lib/sentry.js';

// Dev entry. Socket.IO is mounted here in T-023.
const env = getEnv();
initSentry(env);
const { createApp } = await import('./app.js');
const app = createApp(env);
app.listen(env.PORT, () => {
  console.log(`Furnixa API listening on http://localhost:${env.PORT}`);
});
