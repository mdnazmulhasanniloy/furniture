import { execSync } from 'node:child_process';
import { Writable } from 'node:stream';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_logredact_t005',
  );
});

import { createApp } from '../../src/app.js';
import { createLogger, REDACT_CENSOR } from '../../src/lib/logger.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';

const PASSWORD = 'Sup3rSecretPw1!';
const EMAIL = 'redact@example.com';

/** A REAL pino logger (the test environment's own logger is silent) writing into memory. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = createLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' }, stream);
  return {
    logger,
    lines,
    text: () => lines.join(''),
    entries: () => lines.map((l) => JSON.parse(l)),
  };
}
const settle = () => new Promise((r) => setTimeout(r, 50)); // pino-http logs on response finish

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
});
beforeEach(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      firstName: 'R',
      lastName: 'Edact',
      email: EMAIL,
      passwordHash: await hashPassword(PASSWORD),
      isVerified: true,
    },
  });
});
afterAll(async () => {
  await prisma.refreshToken.deleteMany();
  await prisma.rateLimit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('NFR-04 · log redaction', () => {
  it('NFR-04 · request logs redact credentials', async () => {
    const { logger, text, entries } = capture();
    const app = createApp({ logger });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('X-Request-Id', 'req-redact-1')
      .set('Authorization', 'Bearer eyJ.leaked.jwt')
      .set('Cookie', 'fx_rt=LEAKED-COOKIE')
      .set('X-CSRF-Token', 'LEAKED-CSRF')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    await settle();

    const newRefreshToken = ([] as string[])
      .concat(res.headers['set-cookie']!)
      .find((c) => c.startsWith('fx_rt='))!
      .split(';')[0]!
      .slice('fx_rt='.length);
    expect(newRefreshToken.length).toBeGreaterThan(20);

    const out = text();
    // none of the secret values is anywhere in the output...
    for (const secret of [
      'eyJ.leaked.jwt',
      'LEAKED-COOKIE',
      'LEAKED-CSRF',
      PASSWORD,
      newRefreshToken, // the refresh token the server sets
      res.body.accessToken as string, // the access token it returns
    ]) {
      expect(out, `leaked: ${secret}`).not.toContain(secret);
    }
    // ...while the request id and path still are
    expect(out).toContain('req-redact-1');
    expect(out).toContain('/api/v1/auth/login');

    // and the redaction really ran on the fields pino-http serializes (not merely absent)
    const entry = entries().find((e) => e.res)!;
    expect(entry.req.headers.authorization).toBe(REDACT_CENSOR);
    expect(entry.req.headers.cookie).toBe(REDACT_CENSOR);
    expect(entry.req.headers['x-csrf-token']).toBe(REDACT_CENSOR);
    expect(entry.res.headers['set-cookie']).toBe(REDACT_CENSOR);
    expect(entry.req.id).toBe('req-redact-1');
  });

  it('NFR-04 · request logs of a failed login and a bad refresh contain no credentials either', async () => {
    const { logger, text } = capture();
    const app = createApp({ logger });

    await request(app)
      .post('/api/v1/auth/login')
      .set('X-Request-Id', 'req-redact-2')
      .send({ email: EMAIL, password: 'Wr0ngPasswordX' });
    await request(app)
      .post('/api/v1/auth/refresh')
      .set('X-Request-Id', 'req-redact-3')
      .set('Cookie', 'fx_rt=BAD-COOKIE-VALUE')
      .set('X-CSRF-Token', 'BAD-CSRF-VALUE');
    await settle();

    const out = text();
    for (const secret of ['Wr0ngPasswordX', 'BAD-COOKIE-VALUE', 'BAD-CSRF-VALUE']) {
      expect(out, `leaked: ${secret}`).not.toContain(secret);
    }
    expect(out).toContain('req-redact-2');
    expect(out).toContain('req-redact-3');
  });

  it('NFR-04 · every logger redacts password, newPassword, code, token, accessToken and refreshToken, at the root and one level down', () => {
    const { logger, text } = capture();
    const secrets = ['s-pw', 's-new', '123456', 's-tok', 's-acc', 's-ref'];
    logger.info(
      {
        password: 's-pw',
        newPassword: 's-new',
        code: '123456',
        token: 's-tok',
        accessToken: 's-acc',
        refreshToken: 's-ref',
      },
      'root level',
    );
    logger.info(
      {
        user: { password: 's-pw2', newPassword: 's-new2', code: '654321', token: 's-tok2' },
        body: { accessToken: 's-acc2', refreshToken: 's-ref2' },
      },
      'one level down',
    );
    logger.error(
      { err: Object.assign(new Error('db failed'), { code: '999999' }), requestId: 'r-9' },
      'unhandled error',
    );

    const out = text();
    for (const s of [
      ...secrets,
      's-pw2',
      's-new2',
      '654321',
      's-tok2',
      's-acc2',
      's-ref2',
      '999999',
    ]) {
      expect(out, `leaked: ${s}`).not.toContain(s);
    }
    expect(out).toContain(REDACT_CENSOR);
    // non-secret context stays: the request id and the error message
    expect(out).toContain('r-9');
    expect(out).toContain('db failed');
  });
});
