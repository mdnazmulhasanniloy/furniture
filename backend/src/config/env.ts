import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndefined, z.string().optional());
const intWithDefault = (def: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().positive().default(def));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intWithDefault(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: optStr,
  DATABASE_URL: z.string().default(''),
  CRON_SECRET: optStr,
  R2_ACCOUNT_ID: optStr,
  R2_ACCESS_KEY_ID: optStr,
  R2_SECRET_ACCESS_KEY: optStr,
  R2_BUCKET_NAME: optStr,
  R2_ENDPOINT: optStr,
  R2_PUBLIC_BASE_URL: optStr,
  SMTP_HOST: optStr,
  SMTP_PORT: intWithDefault(587),
  SMTP_USER: optStr,
  SMTP_PASS: optStr,
  MAIL_FROM: optStr,
  ADMIN_EMAIL: optStr,
  ADMIN_PASSWORD: optStr,
  ADMIN_FIRST_NAME: optStr,
  ADMIN_LAST_NAME: optStr,
  SEED_DEMO_DATA: optStr,
  SEED_CONTACT_EMAIL: optStr,
  SEED_CONTACT_PHONE: optStr,
  ACCESS_TOKEN_SECRET: optStr,
  REFRESH_TOKEN_PEPPER: optStr,
  CSRF_SECRET: optStr,
  ACCESS_TOKEN_TTL_SECONDS: intWithDefault(900),
  REFRESH_TOKEN_TTL_SECONDS: intWithDefault(2_592_000),
  AUTH_COOKIE_DOMAIN: optStr,
  AUTH_COOKIE_SECURE: optStr,
  AUTH_COOKIE_SAME_SITE: z.preprocess(
    emptyToUndefined,
    z.enum(['lax', 'strict', 'none']).default('lax'),
  ),
  ARGON2_MEMORY_COST: intWithDefault(19_456),
  ARGON2_TIME_COST: intWithDefault(2),
  ARGON2_PARALLELISM: intWithDefault(1),
  OTP_TTL_SECONDS: intWithDefault(600),
  LOGIN_MAX_FAILURES: intWithDefault(5),
  LOGIN_LOCKOUT_SECONDS: intWithDefault(900),
  MAX_ACTIVE_SESSIONS: intWithDefault(5),
  CORS_ALLOWED_ORIGINS: z.string().default(''),
  STOREFRONT_URL: z.string().default('http://localhost:3100'),
  ADMIN_URL: z.string().default('http://localhost:3101'),
  SENTRY_DSN: optStr,
  SENTRY_ENVIRONMENT: z.string().default('development'),
  REVALIDATE_SECRET: optStr,
  WEB_REVALIDATE_URL: optStr,
  SOCKET_ADAPTER_COLLECTION: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default('socket.io-adapter-events'),
  ),
  SOCKET_ADAPTER_TTL_SECONDS: intWithDefault(3600),
});

/** Every key the schema knows; used by tests to keep `.env.example` and the schema in sync. */
export const ENV_KEYS = Object.keys(schema.shape);

export type TrustProxy = boolean | number | string;

export interface Env extends Omit<
  z.infer<typeof schema>,
  | 'TRUST_PROXY'
  | 'AUTH_COOKIE_SECURE'
  | 'SEED_DEMO_DATA'
  | 'CORS_ALLOWED_ORIGINS'
  | 'ACCESS_TOKEN_SECRET'
  | 'REFRESH_TOKEN_PEPPER'
  | 'CSRF_SECRET'
> {
  TRUST_PROXY: TrustProxy;
  AUTH_COOKIE_SECURE: boolean;
  SEED_DEMO_DATA: boolean;
  CORS_ALLOWED_ORIGINS: string[];
  ACCESS_TOKEN_SECRET: string;
  REFRESH_TOKEN_PEPPER: string;
  CSRF_SECRET: string;
  isProduction: boolean;
}

const MIN_SECRET = 32;

function parseTrustProxy(raw: string | undefined, production: boolean): TrustProxy {
  if (raw === undefined) return production ? 1 : false;
  const v = raw.trim().toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  return raw; // subnet / "loopback" style value understood by Express
}

function parseBool(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  throw new Error(`Invalid environment: ${name} must be true or false, got "${raw}"`);
}

export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === 'production';
  const problems: string[] = [];

  const origins = e.CORS_ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (production && origins.length === 0)
    problems.push('CORS_ALLOWED_ORIGINS is required in production');

  const secret = (key: 'ACCESS_TOKEN_SECRET' | 'REFRESH_TOKEN_PEPPER' | 'CSRF_SECRET'): string => {
    const value = e[key];
    if (production) {
      if (!value || value.length < MIN_SECRET) {
        problems.push(`${key} must be at least ${MIN_SECRET} characters in production`);
        return '';
      }
      return value;
    }
    if (!value) return randomBytes(32).toString('hex');
    if (value.length < MIN_SECRET)
      problems.push(`${key} must be at least ${MIN_SECRET} characters`);
    return value;
  };

  const ACCESS_TOKEN_SECRET = secret('ACCESS_TOKEN_SECRET');
  const REFRESH_TOKEN_PEPPER = secret('REFRESH_TOKEN_PEPPER');
  const CSRF_SECRET = secret('CSRF_SECRET');

  if (e.CRON_SECRET && e.CRON_SECRET.length < MIN_SECRET)
    problems.push(`CRON_SECRET must be at least ${MIN_SECRET} characters when set`);
  if (e.NODE_ENV !== 'test' && !e.DATABASE_URL) problems.push('DATABASE_URL is required');

  let AUTH_COOKIE_SECURE = production;
  try {
    AUTH_COOKIE_SECURE = parseBool('AUTH_COOKIE_SECURE', e.AUTH_COOKIE_SECURE, production);
  } catch (err) {
    problems.push((err as Error).message.replace('Invalid environment: ', ''));
  }

  let SEED_DEMO_DATA = false;
  try {
    SEED_DEMO_DATA = parseBool('SEED_DEMO_DATA', e.SEED_DEMO_DATA, false);
  } catch (err) {
    problems.push((err as Error).message.replace('Invalid environment: ', ''));
  }

  if (problems.length) throw new Error(`Invalid environment: ${problems.join('; ')}`);

  return {
    ...e,
    TRUST_PROXY: parseTrustProxy(e.TRUST_PROXY, production),
    AUTH_COOKIE_SECURE,
    SEED_DEMO_DATA,
    CORS_ALLOWED_ORIGINS: origins,
    ACCESS_TOKEN_SECRET,
    REFRESH_TOKEN_PEPPER,
    CSRF_SECRET,
    isProduction: production,
  };
}

let cached: Env | undefined;
/** Lazily parsed process env (dotenv is loaded by the entry point before first use). */
export function getEnv(): Env {
  return (cached ??= parseEnv(process.env));
}
