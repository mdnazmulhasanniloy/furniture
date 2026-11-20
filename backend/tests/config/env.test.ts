import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENV_KEYS, parseEnv } from '../../src/config/env.js';

const LONG = 'a'.repeat(32);
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mongodb://localhost/x',
  ACCESS_TOKEN_SECRET: LONG,
  REFRESH_TOKEN_PEPPER: LONG,
  CSRF_SECRET: LONG,
  CORS_ALLOWED_ORIGINS: 'https://furnixa.com',
};
const dev = { NODE_ENV: 'development', DATABASE_URL: 'mongodb://localhost/x' };

describe('env', () => {
  it.each(['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_PEPPER', 'CSRF_SECRET'])(
    'NFR-01 · production rejects a missing or short %s',
    (key) => {
      expect(() => parseEnv({ ...prod, [key]: '' })).toThrow(key);
      expect(() => parseEnv({ ...prod, [key]: 'short' })).toThrow(key);
      expect(() => parseEnv(prod)).not.toThrow();
    },
  );

  it('NFR-01 · production requires CORS_ALLOWED_ORIGINS', () => {
    expect(() => parseEnv({ ...prod, CORS_ALLOWED_ORIGINS: '' })).toThrow('CORS_ALLOWED_ORIGINS');
  });

  it('NFR-01 · CORS_ALLOWED_ORIGINS is split into a trimmed list', () => {
    const env = parseEnv({ ...dev, CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test ,' });
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('NFR-01 · outside production empty secrets are generated, 32+ chars and distinct per start', () => {
    const a = parseEnv(dev);
    const b = parseEnv(dev);
    for (const k of ['ACCESS_TOKEN_SECRET', 'REFRESH_TOKEN_PEPPER', 'CSRF_SECRET'] as const) {
      expect(a[k].length).toBeGreaterThanOrEqual(32);
      expect(a[k]).not.toBe(b[k]);
    }
    expect(a.ACCESS_TOKEN_SECRET).not.toBe(a.REFRESH_TOKEN_PEPPER);
  });

  it('NFR-01 · a provided secret is kept outside production', () => {
    expect(parseEnv({ ...dev, CSRF_SECRET: LONG }).CSRF_SECRET).toBe(LONG);
  });

  it('NFR-01 · AUTH_COOKIE_SECURE empty is true in production and false elsewhere', () => {
    expect(parseEnv({ ...prod, AUTH_COOKIE_SECURE: '' }).AUTH_COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...dev, AUTH_COOKIE_SECURE: '' }).AUTH_COOKIE_SECURE).toBe(false);
    expect(parseEnv({ ...dev, AUTH_COOKIE_SECURE: 'true' }).AUTH_COOKIE_SECURE).toBe(true);
    expect(parseEnv({ ...prod, AUTH_COOKIE_SECURE: 'false' }).AUTH_COOKIE_SECURE).toBe(false);
  });

  it('NFR-01 · TRUST_PROXY is 1 in production by default and parses false / numbers', () => {
    expect(parseEnv(prod).TRUST_PROXY).toBe(1);
    expect(parseEnv(dev).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...dev, TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false);
    expect(parseEnv({ ...dev, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(parseEnv({ ...dev, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
  });

  it('NFR-01 · defaults: port 4100, OTP_TTL_SECONDS 600, adapter collection and TTL', () => {
    const env = parseEnv({ ...dev, PORT: '', OTP_TTL_SECONDS: '', SOCKET_ADAPTER_COLLECTION: '' });
    expect(env.PORT).toBe(4100);
    expect(env.OTP_TTL_SECONDS).toBe(600);
    expect(env.SOCKET_ADAPTER_COLLECTION).toBe('socket.io-adapter-events');
    expect(env.SOCKET_ADAPTER_TTL_SECONDS).toBe(3600);
  });

  it('NFR-01 · OTP_TTL_SECONDS and SOCKET_ADAPTER_TTL_SECONDS reject invalid values', () => {
    expect(() => parseEnv({ ...dev, OTP_TTL_SECONDS: 'abc' })).toThrow('OTP_TTL_SECONDS');
    expect(() => parseEnv({ ...dev, SOCKET_ADAPTER_TTL_SECONDS: '0' })).toThrow(
      'SOCKET_ADAPTER_TTL_SECONDS',
    );
    expect(parseEnv({ ...dev, OTP_TTL_SECONDS: '120' }).OTP_TTL_SECONDS).toBe(120);
  });

  it('NFR-01 · CRON_SECRET is optional but must be 32+ chars when set', () => {
    expect(parseEnv({ ...dev, CRON_SECRET: '' }).CRON_SECRET).toBeUndefined();
    expect(() => parseEnv({ ...dev, CRON_SECRET: 'short' })).toThrow('CRON_SECRET');
    expect(parseEnv({ ...dev, CRON_SECRET: LONG }).CRON_SECRET).toBe(LONG);
  });

  it('NFR-01 · DATABASE_URL is required outside test', () => {
    expect(() => parseEnv({ NODE_ENV: 'development' })).toThrow('DATABASE_URL');
    expect(() => parseEnv({ NODE_ENV: 'test' })).not.toThrow();
  });

  it('NFR-01 · every key in .env.example is known to the schema', () => {
    const text = readFileSync(resolve(__dirname, '../../.env.example'), 'utf8');
    const keys = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(30);
    expect(keys.filter((k) => !ENV_KEYS.includes(k as string))).toEqual([]);
  });

  it('NFR-01 · the shipped .env.example values parse in development', () => {
    const text = readFileSync(resolve(__dirname, '../../.env.example'), 'utf8');
    const raw: Record<string, string> = { DATABASE_URL: 'mongodb://localhost/x' };
    for (const m of text.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
      if (m[1] !== 'DATABASE_URL') raw[m[1] as string] = m[2] as string;
    }
    expect(() => parseEnv(raw)).not.toThrow();
  });
});

describe('SEED_DEMO_DATA', () => {
  it('NFR-05 · defaults to false and parses true/false', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).SEED_DEMO_DATA).toBe(false);
    expect(parseEnv({ NODE_ENV: 'test', SEED_DEMO_DATA: 'true' }).SEED_DEMO_DATA).toBe(true);
    expect(() => parseEnv({ NODE_ENV: 'test', SEED_DEMO_DATA: 'maybe' })).toThrow('SEED_DEMO_DATA');
  });
});
