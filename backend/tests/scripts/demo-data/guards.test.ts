import { describe, expect, it, vi } from 'vitest';
import {
  assertSafeTarget,
  DemoGuardError,
  hasConfirmFlag,
  maskDatabaseUrl,
  parseDbName,
} from '../../../scripts/demo-data/guards.js';
import { run } from '../../../scripts/demo-data/reset-and-seed.js';

const DEV_URL =
  'mongodb+srv://user:secret@cluster0.example.mongodb.net/furniture_dev?retryWrites=true';
const GOOD_ENV = {
  NODE_ENV: 'development',
  DATABASE_URL: DEV_URL,
  // meets the one shared password policy (owner 2026-11-24), like any usable demo password
  DEMO_CUSTOMER_PASSWORD: 'DemoPassw0rd!',
};

/** A prisma stand-in that fails the test on any call: guards must trip before the database is touched. */
const forbiddenPrisma = () =>
  new Proxy(
    {},
    {
      get: () => {
        throw new Error('database was touched');
      },
    },
  ) as never;

describe('T-078 · demo reset guards', () => {
  it('T-078 · refuses a NODE_ENV other than development', () => {
    for (const nodeEnv of ['production', 'test', 'staging', '', undefined]) {
      expect(() => assertSafeTarget({ nodeEnv, databaseUrl: DEV_URL })).toThrow(DemoGuardError);
    }
  });

  it('T-078 · refuses every database name except furniture_dev and furniture_preview', () => {
    for (const name of [
      'furniture_prod',
      'furniture_dev2',
      'Furniture_Dev',
      'furniture',
      'furnixa_test',
      'furniture_dev_x',
    ]) {
      const url = `mongodb://localhost:27017/${name}`;
      expect(() => assertSafeTarget({ nodeEnv: 'development', databaseUrl: url })).toThrow(
        DemoGuardError,
      );
    }
    expect(() =>
      assertSafeTarget({ nodeEnv: 'development', databaseUrl: 'mongodb://localhost:27017' }),
    ).toThrow(DemoGuardError);
    expect(() => assertSafeTarget({ nodeEnv: 'development', databaseUrl: undefined })).toThrow(
      DemoGuardError,
    );
    expect(() =>
      assertSafeTarget({
        nodeEnv: 'development',
        databaseUrl: 'mongodb://h/furniture_prod?x=furniture_dev',
      }),
    ).toThrow(DemoGuardError);
  });

  it('T-078 · accepts furniture_dev and furniture_preview (srv and plain, with options)', () => {
    expect(assertSafeTarget({ nodeEnv: 'development', databaseUrl: DEV_URL }).dbName).toBe(
      'furniture_dev',
    );
    expect(
      assertSafeTarget({
        nodeEnv: 'development',
        databaseUrl: 'mongodb://localhost:27017/furniture_preview',
      }).dbName,
    ).toBe('furniture_preview');
  });

  it('T-078 · parses the database name and masks credentials', () => {
    expect(parseDbName(DEV_URL)).toBe('furniture_dev');
    expect(parseDbName('not a url')).toBeNull();
    expect(maskDatabaseUrl(DEV_URL)).not.toContain('secret');
    expect(maskDatabaseUrl(DEV_URL)).toContain('furniture_dev');
  });

  it('T-078 · --confirm is detected only as an exact flag', () => {
    expect(hasConfirmFlag(['--confirm'])).toBe(true);
    expect(hasConfirmFlag(['--confirmed', 'confirm', '-confirm'])).toBe(false);
    expect(hasConfirmFlag([])).toBe(false);
  });

  it('T-078 · run() with the wrong NODE_ENV exits 1 and never builds a database client', async () => {
    const deps = vi.fn(async () => ({ prisma: forbiddenPrisma() }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const code = await run({
      argv: ['--confirm'],
      env: { ...GOOD_ENV, NODE_ENV: 'production' },
      deps,
    });
    expect(code).toBe(1);
    expect(deps).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('T-078 · run() with the wrong database name exits 1 and never builds a database client', async () => {
    const deps = vi.fn(async () => ({ prisma: forbiddenPrisma() }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = { ...GOOD_ENV, DATABASE_URL: 'mongodb://localhost/furniture_prod' };
    expect(await run({ argv: ['--confirm'], env, deps })).toBe(1);
    expect(deps).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('T-078 · run() with --confirm and a DEMO_CUSTOMER_PASSWORD that breaks the shared policy exits 1 before touching anything (owner 2026-11-24)', async () => {
    const deps = vi.fn(async () => ({ prisma: forbiddenPrisma() }));
    const messages: string[] = [];
    const err = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => void messages.push(args.join(' ')));
    // one failing case per rule of the shared policy, plus missing and empty
    const cases: [string | undefined, string][] = [
      [undefined, 'length'],
      ['', 'length'],
      ['Ab1!xyz', 'length'], // 7 characters
      ['passw0rd!', 'upper'],
      ['PASSW0RD!', 'lower'],
      ['Password!', 'digit'],
      ['Passw0rdOne', 'symbol'],
      ['averylongdemopassword', 'upper'], // the old 12-character rule would have allowed this
    ];
    for (const [pw, rule] of cases) {
      messages.length = 0;
      const code = await run({
        argv: ['--confirm'],
        env: { ...GOOD_ENV, DEMO_CUSTOMER_PASSWORD: pw },
        deps,
      });
      expect(code, String(pw)).toBe(1);
      // the message names the unmet rule, so the developer knows what to change
      expect(messages.join('\n'), String(pw)).toContain(rule);
      expect(messages.join('\n'), String(pw)).toContain('password policy');
    }
    expect(deps).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
