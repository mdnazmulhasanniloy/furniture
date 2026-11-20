import { pino } from 'pino';
import type { Env } from '../config/env.js';

export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>) {
  return pino({ level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL });
}
export type Logger = ReturnType<typeof createLogger>;
