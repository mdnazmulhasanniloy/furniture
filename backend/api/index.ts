import { app } from '../src/app.js';
import { getEnv } from '../src/config/env.js';
import { initSentry } from '../src/lib/sentry.js';

initSentry(getEnv());

export default app;
