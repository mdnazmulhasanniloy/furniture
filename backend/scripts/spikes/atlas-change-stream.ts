import 'dotenv/config';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdapter } from '@socket.io/mongo-adapter';
import { Emitter } from '@socket.io/mongo-emitter';
import { MongoClient } from 'mongodb';
import { Server } from 'socket.io';
import { io as clientIo } from 'socket.io-client';

/**
 * T-023 spike (ADR-012 §2): does the chosen Atlas tier run change streams, and does the real
 * @socket.io/mongo-adapter + mongo-emitter pair deliver across two server instances on it?
 *
 * Run from `backend/` with the Atlas cluster in `.env`:
 *
 *     npx tsx scripts/spikes/atlas-change-stream.ts
 *
 * PASS: every step prints `PASS step N — …` and the script ends with `SPIKE PASS` (exit 0).
 * FAIL: the first failing step prints `FAIL step N — <reason>` and the script ends with
 *       `SPIKE FAIL` (exit 1) → record blocker B-025 and fall back to a capped collection (ADR-012).
 */

const TIMEOUT_MS = 5000;

const url = process.env.DATABASE_URL;
const collectionName = process.env.SOCKET_ADAPTER_COLLECTION?.trim() || 'socket.io-adapter-events';
const ttlSeconds = Number(process.env.SOCKET_ADAPTER_TTL_SECONDS || 3600);

function within<T>(label: string, promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
      t.unref();
    }),
  ]);
}

async function main(): Promise<void> {
  if (!url) {
    console.error('FAIL step 0 — DATABASE_URL is not set (put the Atlas URL in backend/.env)');
    process.exit(1);
  }
  const client = new MongoClient(url, { maxPoolSize: 2, serverSelectionTimeoutMS: 10_000 });
  const closers: (() => Promise<void> | void)[] = [() => client.close()];
  let failed = false;
  const pass = (step: number, msg: string) => console.log(`PASS step ${step} — ${msg}`);
  const fail = (step: number, err: unknown) => {
    failed = true;
    console.error(`FAIL step ${step} — ${err instanceof Error ? err.message : String(err)}`);
  };

  try {
    const db = client.db();
    const collection = db.collection(collectionName);

    // Step 1: connectivity + TTL index (same index T-023 creates in production).
    try {
      await db.command({
        createIndexes: collectionName,
        indexes: [{ key: { createdAt: 1 }, name: 'createdAt_ttl', expireAfterSeconds: ttlSeconds }],
      });
      pass(1, `connected; TTL index on ${db.databaseName}.${collectionName} (${ttlSeconds} s)`);
    } catch (err) {
      if ((err as { code?: number }).code === 85) {
        pass(1, `connected; TTL index already exists with a different TTL (fine for the spike)`);
      } else {
        throw err;
      }
    }

    // Step 2: raw change stream — insert one document, expect the change event within 5 s.
    const stream = collection.watch();
    closers.unshift(() => stream.close());
    const change = new Promise<void>((resolve, reject) => {
      stream.on('change', (event) => {
        if (event.operationType === 'insert') resolve();
      });
      stream.on('error', reject);
    });
    // Give the stream a moment to be fully open before the insert.
    await new Promise((r) => setTimeout(r, 500));
    const t2 = Date.now();
    await collection.insertOne({ spike: 'atlas-change-stream', createdAt: new Date() });
    try {
      await within('change stream event', change);
      pass(2, `change stream delivered the insert event in ${Date.now() - t2} ms`);
    } catch (err) {
      fail(2, err);
    } finally {
      await stream.close();
      await collection.deleteMany({ spike: 'atlas-change-stream' });
    }

    // Step 3: real adapter + emitter across two separate Socket.IO server instances.
    if (!failed) {
      const servers = [new Server(), new Server()];
      const https = servers.map((io, i) => {
        const httpServer = createServer();
        io.adapter(createAdapter(collection, { addCreatedAtField: true }));
        io.on('connection', (socket) => void socket.join('spike-room'));
        io.attach(httpServer);
        closers.unshift(() => new Promise<void>((r) => io.close(() => r())));
        httpServer.listen(0, '127.0.0.1');
        return { httpServer, i };
      });
      await Promise.all(
        https.map(({ httpServer }) => new Promise((r) => httpServer.once('listening', r))),
      );
      const portB = (https[1]!.httpServer.address() as AddressInfo).port;
      const socket = clientIo(`http://127.0.0.1:${portB}`, {
        transports: ['websocket'],
        reconnection: false,
      });
      closers.unshift(() => void socket.disconnect());
      try {
        await within(
          'client connect to instance B',
          new Promise<void>((resolve, reject) => {
            socket.on('connect', () => resolve());
            socket.on('connect_error', reject);
          }),
        );
        // Instance A must learn about B through the collection before room joins propagate.
        await new Promise((r) => setTimeout(r, 1000));
        const received = new Promise<void>((resolve) => socket.on('spike:event', () => resolve()));
        const t3 = Date.now();
        const emitter = new Emitter(collection, undefined, { addCreatedAtField: true });
        emitter.to('spike-room').emit('spike:event', { at: t3 });
        await within('cross-instance delivery', received);
        pass(3, `emitter → adapter → socket on instance B in ${Date.now() - t3} ms`);
      } catch (err) {
        fail(3, err);
      }
    }
  } catch (err) {
    fail(1, err);
  } finally {
    for (const close of closers) {
      try {
        await close();
      } catch {
        /* ignore */
      }
    }
  }

  console.log(failed ? 'SPIKE FAIL' : 'SPIKE PASS');
  process.exit(failed ? 1 : 0);
}

void main();
