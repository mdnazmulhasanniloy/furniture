import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_deploy_t026',
  );
});

// Spy wrapper around the real factory: proves the per-instance attach memo and hands the test the
// `io` instance for a clean shutdown (the Vercel handler keeps no reference we could reach).
vi.mock('../../src/lib/socketServer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/socketServer.js')>();
  return { ...actual, createSocketServer: vi.fn(actual.createSocketServer) };
});

import request from 'supertest';
import type { Server as SocketServer } from 'socket.io';
import type { Socket as ClientSocket } from 'socket.io-client';
import apiEntry from '../../api/index.js';
import socketHandler from '../../api/socket-io.js';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { closeMongoClient, ensureSocketIndexes } from '../../src/lib/mongo.js';
import { prisma } from '../../src/lib/prisma.js';
import { createSocketServer, SOCKET_PATH } from '../../src/lib/socketServer.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { connectClient, connected, waitForEvent } from '../helpers/socket.js';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));

// The runtime model `api/socket-io.ts` targets (ADR-012 §1): Vercel invokes the handler per request
// on a shared Node server; the test reproduces it with a plain http server whose only request
// listener is the function handler, exactly like the platform's catch-all dispatch.
let httpServer: HttpServer;
let port: number;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await ensureSocketIndexes();
  httpServer = createServer((req, res) => socketHandler(req, res));
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  const io = vi.mocked(createSocketServer).mock.results[0]?.value as SocketServer | undefined;
  // io.close() also closes the http server it attached to; without an attach, close the server alone.
  if (io) await new Promise<void>((resolve) => io.close(() => resolve()));
  else await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await closeMongoClient();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('Vercel configuration (T-026)', () => {
  it('NFR-08 · api/index.ts default-exports the Express app (GET /health answers 200)', async () => {
    const res = await request(apiEntry).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('NFR-08 · the socket function attaches one Socket.IO server per instance and answers plain HTTP with websocket-only', async () => {
    const first = await fetch(`http://127.0.0.1:${port}/api/socket-io`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, transport: 'websocket-only' });
    expect(vi.mocked(createSocketServer)).toHaveBeenCalledTimes(1);

    // A second invocation on the same instance must not attach a second Socket.IO server.
    const second = await fetch(`http://127.0.0.1:${port}/api/socket-io`);
    expect(second.status).toBe(200);
    expect(vi.mocked(createSocketServer)).toHaveBeenCalledTimes(1);
  });

  it('NFR-08 · a websocket client connects and receives events through the socket function', async () => {
    const user = await prisma.user.create({
      data: {
        firstName: 'Deploy',
        lastName: 'Check',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        isVerified: true,
      },
    });
    const socket = connectClient(port, signAccessToken(user));
    clients.push(socket);
    await connected(socket);
    socketEmitter.toUser(user.id).emit('notification:new', { id: 'deploy-check' });
    expect(await waitForEvent(socket, 'notification:new')).toEqual({ id: 'deploy-check' });
  });

  it('NFR-08 · vercel.json matches ADR-012 (functions exist, socket rewrite precedes the catch-all, cron path is mounted, schedule is daily)', async () => {
    const cfg = JSON.parse(readFileSync(join(backendRoot, 'vercel.json'), 'utf8')) as {
      functions: Record<string, { maxDuration: number }>;
      rewrites: { source: string; destination: string }[];
      crons: { path: string; schedule: string }[];
    };

    expect(cfg.functions['api/index.ts']?.maxDuration).toBe(30);
    expect(cfg.functions['api/socket-io.ts']?.maxDuration).toBe(300);
    for (const file of Object.keys(cfg.functions)) {
      expect(existsSync(join(backendRoot, file)), `${file} exists`).toBe(true);
    }

    const sources = cfg.rewrites.map((r) => r.source);
    const socketRewrite = sources.indexOf('/api/socket-io/(.*)');
    const catchAll = sources.indexOf('/(.*)');
    expect(socketRewrite).toBeGreaterThanOrEqual(0);
    expect(catchAll).toBe(sources.length - 1);
    expect(socketRewrite).toBeLessThan(catchAll);
    // Rewrite-by-destination routing: the requested path travels in __originalPath (vercelUrl.ts).
    expect(cfg.rewrites[socketRewrite]?.destination).toBe(
      '/api/socket-io?__originalPath=/api/socket-io/$1',
    );
    expect(cfg.rewrites[catchAll]?.destination).toBe('/api/index?__originalPath=/$1');
    // The live socket path must be routed by the socket rewrite, never by the API catch-all.
    expect(SOCKET_PATH.startsWith('/api/socket-io/')).toBe(true);

    expect(cfg.crons).toEqual([{ path: '/internal/cron/cleanup', schedule: '0 3 * * *' }]);
    // The cron path is really mounted: with CRON_SECRET set, an unauthenticated GET is 401, not 404.
    const app = createApp({ env: { ...getEnv(), CRON_SECRET: 'x'.repeat(32) } });
    const res = await request(app).get(cfg.crons[0]!.path);
    expect(res.status).toBe(401);
  });

  it('NFR-08 · a request arriving with the rewritten destination URL is restored to the original path', async () => {
    // New Vercel routing: req.url is the rewrite destination; __originalPath carries the request.
    const rewritten = await request(apiEntry).get('/api/index?__originalPath=/health');
    expect(rewritten.status).toBe(200);
    expect(rewritten.body).toEqual({ status: 'ok' });

    // Old routing behaviour / local dev: the original URL arrives untouched and stays untouched.
    const direct = await request(apiEntry).get('/health');
    expect(direct.status).toBe(200);

    // A value that is not a plain path is ignored (the URL stays /api/index → 404, never a rewrite).
    const schemeRelative = await request(apiEntry).get('/api/index?__originalPath=//evil.example');
    expect(schemeRelative.status).toBe(404);
  });

  it('NFR-08 · a websocket upgrade arriving with the rewritten destination URL is restored for engine.io', async () => {
    // Raw upgrade request the way the platform would deliver it under rewrite-by-destination
    // routing: URL = /api/socket-io with the requested path in __originalPath. A real client
    // requests `${SOCKET_PATH}/?EIO=…` (engine.io normalizes its path with a trailing slash), so
    // that is what the rewrite captures. engine.io answers 101 only when the restored path
    // matches; unrestored, it would never upgrade.
    const requestLine =
      `GET /api/socket-io?__originalPath=${encodeURIComponent(`${SOCKET_PATH}/`)}` +
      `&EIO=4&transport=websocket HTTP/1.1\r\n`;
    const head = await new Promise<string>((resolve, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          requestLine +
            `Host: 127.0.0.1:${port}\r\n` +
            'Connection: Upgrade\r\nUpgrade: websocket\r\n' +
            `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
            'Sec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      let buffer = '';
      const finish = (value: string) => {
        socket.destroy();
        resolve(value);
      };
      socket.on('data', (chunk) => {
        buffer += String(chunk);
        if (buffer.includes('\r\n\r\n')) finish(buffer);
      });
      socket.on('close', () => finish(buffer));
      socket.on('error', reject);
      setTimeout(() => finish(buffer), 8000).unref();
    });
    expect(head.startsWith('HTTP/1.1 101')).toBe(true);
  });

  it('NFR-08 · the Prisma client is generated for the Vercel runtime (binaryTargets + build script)', () => {
    const schema = readFileSync(join(backendRoot, 'prisma', 'schema.prisma'), 'utf8');
    const generator = /generator client \{[\s\S]*?\}/.exec(schema)?.[0] ?? '';
    expect(generator).toContain('"native"');
    expect(generator).toContain('"rhel-openssl-3.0.x"');

    const pkg = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8')) as {
      engines: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.scripts.build).toMatch(/^prisma generate && /);
    expect(pkg.scripts.postinstall).toBe('prisma generate');
    // Pin the runtime Vercel builds and runs on, and keep the Vercel-resolver type-check wired.
    expect(pkg.engines.node).toBe('22.x');
    expect(pkg.scripts['build:vercel']).toBe('node scripts/vercel-typecheck.mjs');
  });
});
