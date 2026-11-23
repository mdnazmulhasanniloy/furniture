import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createLogger } from '../src/lib/logger.js';
import { AppError } from '../src/lib/errors.js';
import { createErrorHandler, notFoundHandler } from '../src/middleware/error.js';
import { requestId } from '../src/middleware/requestId.js';
import { validate } from '../src/middleware/validate.js';

const env = parseEnv({
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3100',
});

describe('health', () => {
  it('NFR-04 · GET /health returns 200 {status: "ok"}', async () => {
    const res = await request(createApp(env)).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('security middleware', () => {
  it('NFR-01 · helmet security headers are set and x-powered-by is hidden', async () => {
    const res = await request(createApp(env)).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('NFR-01 · CORS allows a listed origin with credentials', async () => {
    const res = await request(createApp(env)).get('/health').set('Origin', 'http://localhost:3100');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3100');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('NFR-01 · CORS sends no allow headers for an unlisted origin', async () => {
    const res = await request(createApp(env)).get('/health').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('NFR-01 · trust proxy follows TRUST_PROXY (forwarded IP used when 1)', async () => {
    const probe = express();
    probe.set('trust proxy', 1);
    probe.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    const res = await request(probe).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
    expect(createApp(parseEnv({ NODE_ENV: 'test', TRUST_PROXY: '1' })).get('trust proxy')).toBe(1);
    expect(createApp(env).get('trust proxy')).toBe(false);
  });
});

describe('error handling', () => {
  function appWith(setup: (app: express.Express) => void) {
    const app = express();
    app.use(requestId);
    app.use(express.json());
    setup(app);
    app.use(notFoundHandler);
    app.use(createErrorHandler(createLogger(env)));
    return app;
  }

  it('NFR-04 · unknown route returns 404 in the Error schema with a requestId', async () => {
    const res = await request(createApp(env)).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: 'NOT_FOUND', message: expect.any(String) });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('NFR-04 · an unexpected throw returns 500 INTERNAL_ERROR without leaking the message or stack', async () => {
    const app = appWith((a) =>
      a.get('/boom', () => {
        throw new Error('secret db password');
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret db password');
    expect(JSON.stringify(res.body)).not.toContain('at ');
    expect(res.body.requestId).toBeTruthy();
  });

  it('NFR-04 · AppError keeps its status, code and details', async () => {
    const app = appWith((a) =>
      a.get('/conflict', () => {
        throw new AppError(409, 'CONFLICT', 'Already exists', { field: 'email' });
      }),
    );
    const res = await request(app).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'CONFLICT',
      message: 'Already exists',
      details: { field: 'email' },
    });
  });

  it('NFR-04 · a zod failure returns 422 VALIDATION_ERROR with details', async () => {
    const app = appWith((a) =>
      a.post('/items', validate({ body: z.object({ name: z.string().min(1) }) }), (_req, res) => {
        res.json({ ok: true });
      }),
    );
    const res = await request(app).post('/items').send({});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0].path).toEqual(['name']);
    expect(res.body.requestId).toBeTruthy();
  });

  it('NFR-04 · malformed JSON returns 400 in the Error schema', async () => {
    const res = await request(createApp(env))
      .post('/api/v1/anything')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST' });
    expect(res.body.requestId).toBeTruthy();
  });

  it('NFR-04 · an incoming x-request-id is echoed and a missing or invalid one is generated', async () => {
    const app = createApp(env);
    const echoed = await request(app).get('/health').set('x-request-id', 'trace-123');
    expect(echoed.headers['x-request-id']).toBe('trace-123');
    const generated = await request(app).get('/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const invalid = await request(app).get('/health').set('x-request-id', 'bad id with spaces!');
    expect(invalid.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/**
 * T-029 (zod 3→4): zod 3 had a DoS advisory — validating oversized constrained collections could
 * exhaust memory. Defense in depth: the 1mb body-parser limit caps bytes, and schema `.max()`
 * rejects oversized-but-under-limit payloads fast. The timing bounds are generous (normal runs are
 * tens of ms); they exist to fail loudly on a quadratic or memory-exhausting regression.
 */
describe('NFR-01 · oversized payloads are rejected quickly (T-029)', () => {
  /** Mirrors createApp's body parser (1mb limit) + validate + error handler, no DB routes. */
  function payloadApp() {
    const app = express();
    app.use(requestId);
    app.use(express.json({ limit: '1mb' }));
    app.post(
      '/bulk',
      validate({
        body: z
          .object({ tags: z.array(z.string().max(60)).max(50), note: z.string().max(500) })
          .strict(),
      }),
      (_req, res) => {
        res.json({ ok: true });
      },
    );
    app.use(createErrorHandler(createLogger(env)));
    return app;
  }

  it('NFR-01 · a body over the 1mb body-parser limit is 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await request(createApp(env))
      .post('/api/v1/anything')
      .send({ note: 'x'.repeat(1_100_000) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(res.body.requestId).toBeTruthy();
  });

  it('NFR-01 · a 100k-element array under the byte limit is 422 via the schema max, quickly', async () => {
    const tags = Array.from({ length: 100_000 }, () => 'abc'); // ~600KB JSON, under the 1mb limit
    const started = performance.now();
    const res = await request(payloadApp()).post('/bulk').send({ tags, note: 'n' });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0]).toMatchObject({ code: 'too_big', path: ['tags'] });
    expect(elapsed).toBeLessThan(2000);
  });

  it('NFR-01 · a 900KB string under the byte limit is 422 via the schema max, quickly', async () => {
    const started = performance.now();
    const res = await request(payloadApp())
      .post('/bulk')
      .send({ tags: [], note: 'x'.repeat(900_000) });
    const elapsed = performance.now() - started;
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details[0]).toMatchObject({ code: 'too_big', path: ['note'] });
    expect(elapsed).toBeLessThan(2000);
  });
});
