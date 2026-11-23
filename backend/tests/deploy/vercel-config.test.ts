import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { Server as HttpServer } from 'node:http';
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

import request from 'supertest';
import type { Socket as ServerSocket } from 'socket.io';
import type { Socket as ClientSocket } from 'socket.io-client';
import apiEntry from '../../api/index.js';
import socketServer, { io } from '../../api/socket-io.js';
import { createApp } from '../../src/app.js';
import { getEnv } from '../../src/config/env.js';
import { socketEmitter } from '../../src/lib/emitter.js';
import { closeMongoClient } from '../../src/lib/mongo.js';
import { prisma } from '../../src/lib/prisma.js';
import { SOCKET_PATH } from '../../src/lib/socketServer.js';
import { signAccessToken } from '../../src/lib/tokens.js';
import { connectClient, connected, waitForDisconnect, waitForEvent } from '../helpers/socket.js';

const backendRoot = fileURLToPath(new URL('../..', import.meta.url));

// The runtime model `api/socket-io.ts` targets (ADR-012 §1, vercel.com/docs/functions/websockets):
// the function default-exports an http.Server with Socket.IO attached; the platform routes
// /api/socket-io/* — including the websocket upgrade — to that server. The test listens on the
// exported server directly, exactly as the platform does.
let port: number;
const clients: ClientSocket[] = [];

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  await new Promise<void>((resolve) => socketServer.listen(0, '127.0.0.1', () => resolve()));
  port = (socketServer.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  // io.close() also closes the exported http server and the adapter's change stream.
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await closeMongoClient();
  await prisma.notification.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('Vercel configuration (T-026)', () => {
  it('NFR-08 · api/index.ts default-exports the Express app (GET /health answers 200)', async () => {
    const res = await request(apiEntry).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('NFR-08 · the socket function default-exports an http.Server and engine.io owns the exact function path', async () => {
    expect(socketServer).toBeInstanceOf(HttpServer);
    // Vercel routes ONLY the exact function path /api/socket-io to this server (sub-paths got the
    // platform 404 on the deployed preview, 2026-11-23), so Socket.IO must serve that very path:
    // a GET without an EIO query is answered by engine.io (400 "Transport unknown"), proving
    // engine.io — not the fallback — owns the one URL the platform delivers.
    const probe = await fetch(`http://127.0.0.1:${port}${SOCKET_PATH}`);
    expect(probe.status).toBe(400);
    expect(await probe.json()).toEqual({ code: 0, message: 'Transport unknown' });
    // Paths outside SOCKET_PATH (never sent by Vercel) fall through to the JSON responder.
    const fallback = await fetch(`http://127.0.0.1:${port}/`);
    expect(fallback.status).toBe(200);
    expect(await fallback.json()).toEqual({ ok: true, transport: 'websocket-only' });
  });

  it('NFR-08 · the client wire path is exactly /api/socket-io (addTrailingSlash false, no /socket.io suffix)', async () => {
    expect(SOCKET_PATH).toBe('/api/socket-io');
    // Record what a real socket.io-client (the shared helper = the ADR-012 §3 client contract)
    // actually requests: it must be the one URL Vercel routes to the function. The old
    // '/api/socket-io/socket.io/' wire path is a platform 404 on Vercel and must not be used.
    const upgradeUrls: string[] = [];
    socketServer.prependListener('upgrade', (req) => {
      upgradeUrls.push(req.url ?? '');
    });
    const user = await prisma.user.create({
      data: {
        firstName: 'Wire',
        lastName: 'Path',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        isVerified: true,
      },
    });
    const socket = connectClient(port, signAccessToken(user));
    clients.push(socket);
    await connected(socket);
    expect(upgradeUrls.length).toBeGreaterThan(0);
    for (const url of upgradeUrls) {
      expect(url.split('?')[0], 'upgrade path is the exact function path').toBe(SOCKET_PATH);
    }
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

  it('NFR-08 · vercel.json matches ADR-012 (functions exist, the socket path is never rewritten, cron path is mounted, schedule is daily)', async () => {
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

    // Exactly one rewrite: the API catch-all, excluding the socket function's whole subtree.
    // Upgrade requests pass through rewrites BEFORE upgrading (Vercel WebSocket docs), so any
    // rewrite matching the socket path moves it away from SOCKET_PATH and breaks engine.io.
    expect(cfg.rewrites).toEqual([
      { source: '/((?!api/socket-io).*)', destination: '/api/index?__originalPath=/$1' },
    ]);
    const catchAll = new RegExp(`^${cfg.rewrites[0]!.source}$`);
    expect(catchAll.test(SOCKET_PATH)).toBe(false);
    expect(catchAll.test(`${SOCKET_PATH}/`)).toBe(false);
    // The retired wire path stays excluded too (an old client must hit the platform 404, never
    // get rewritten into the API function).
    expect(catchAll.test('/api/socket-io/socket.io')).toBe(false);
    expect(catchAll.test('/api/socket-io/socket.io/')).toBe(false);
    for (const apiPath of ['/health', '/api/v1/auth/login', '/internal/cron/cleanup']) {
      expect(catchAll.test(apiPath), `${apiPath} reaches the API function`).toBe(true);
    }

    expect(cfg.crons).toEqual([{ path: '/internal/cron/cleanup', schedule: '0 3 * * *' }]);
    // The cron path is really mounted: with CRON_SECRET set, an unauthenticated GET is 401, not 404.
    const app = createApp({ env: { ...getEnv(), CRON_SECRET: 'x'.repeat(32) } });
    const res = await request(app).get(cfg.crons[0]!.path);
    expect(res.status).toBe(401);
  });

  it('NFR-08 · a request arriving with the rewritten destination URL is restored to the original path', async () => {
    // Rewrite-by-destination routing: req.url is the destination; __originalPath carries the request.
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

  it('NFR-08 · a websocket upgrade arriving with the rewritten destination URL is restored for engine.io (defensive)', async () => {
    // No rewrite touches the socket path any more, but the restore listener stays as a guard: a
    // raw upgrade delivered with the requested path in __originalPath (a real client requests
    // `${SOCKET_PATH}?EIO=…`) must still reach engine.io, which answers 101 only when the
    // restored path matches.
    const requestLine =
      `GET /api/socket-io?__originalPath=${encodeURIComponent(SOCKET_PATH)}` +
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

  it('NOTIF-01 · after a transport close the client auto-reconnects within seconds and the gap notification is fetched after reconnect (ADR-012 §3)', async () => {
    const user = await prisma.user.create({
      data: {
        firstName: 'Gap',
        lastName: 'Reconnect',
        email: `${randomUUID()}@example.com`,
        passwordHash: 'x',
        isVerified: true,
      },
    });
    const token = signAccessToken(user);
    const serverSide = new Promise<ServerSocket>((resolve) => io.once('connection', resolve));
    const socket = connectClient(port, token, {
      reconnection: true,
      reconnectionDelay: 200,
      reconnectionDelayMax: 200,
      randomizationFactor: 0,
    });
    clients.push(socket);
    await connected(socket);
    const serverSocket = await serverSide;

    // Arm both watchers BEFORE the close (a waiter attached after an await can miss a fast
    // reconnect — the --long failure mode), then close the underlying engine connection the way
    // the platform's duration limit does: no namespace DISCONNECT packet, so the client sees
    // reason 'transport close' and reconnects by itself ('io server disconnect' would not).
    const disconnected = waitForDisconnect(socket);
    const reconnected = connected(socket, 5000);
    serverSocket.conn.close();
    expect(await disconnected).toBe('transport close');

    // During the gap: the notification row is created while the client is offline. The live emit
    // for it is lost by design — the row is the source of truth (ADR-012 §2) and the client
    // re-fetches GET /notifications on every connect (ADR-012 §3).
    const gap = await prisma.notification.create({
      data: {
        userId: user.id,
        type: 'ORDER_STATUS',
        title: { en: 'Order update', ar: 'تحديث الطلب' },
        body: { en: 'created during the gap', ar: 'أُنشئ أثناء الانقطاع' },
        link: null,
        data: { orderId: 'gap-check' },
        readAt: null,
      },
    });

    await reconnected; // automatic — the test never calls socket.connect()

    const res = await request(apiEntry)
      .get('/api/v1/notifications')
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const items = res.body.items as { id: string }[];
    expect(items.map((n) => n.id)).toContain(gap.id);

    // Live delivery works again on the reconnected socket.
    socketEmitter.toUser(user.id).emit('notification:new', { id: 'after-reconnect' });
    expect(await waitForEvent(socket, 'notification:new')).toEqual({ id: 'after-reconnect' });
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
