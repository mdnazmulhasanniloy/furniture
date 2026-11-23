import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Server } from 'socket.io';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import type { Env } from '../../src/config/env.js';
import { createSocketServer, SOCKET_PATH } from '../../src/lib/socketServer.js';

export interface TestSocketServer {
  io: Server;
  port: number;
  close(): Promise<void>;
}

/** One real Socket.IO server instance (the T-023 factory) on an ephemeral 127.0.0.1 port. */
export async function startSocketServer(env: Env): Promise<TestSocketServer> {
  const httpServer = createServer();
  const io = createSocketServer(httpServer, env);
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (httpServer.address() as AddressInfo).port;
  // io.close() also closes the http server and, on the last namespace, the adapter's change stream.
  return { io, port, close: () => new Promise<void>((resolve) => io.close(() => resolve())) };
}

export function connectClient(
  port: number,
  token?: string,
  opts: { extraHeaders?: Record<string, string> } = {},
): ClientSocket {
  return clientIo(`http://127.0.0.1:${port}`, {
    path: SOCKET_PATH,
    addTrailingSlash: false,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    auth: token === undefined ? undefined : { token },
    ...opts,
  });
}

/** Resolves on `connect`, rejects with the `connect_error` error. */
export function connected(socket: ClientSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for connect')), ms);
    socket.once('connect', () => {
      clearTimeout(t);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

/** Resolves with the `connect_error` message; a successful connect rejects. */
export function connectError(socket: ClientSocket, ms = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for connect_error')), ms);
    socket.once('connect_error', (err) => {
      clearTimeout(t);
      resolve(err.message);
    });
    socket.once('connect', () => {
      clearTimeout(t);
      reject(new Error('connected although a connect_error was expected'));
    });
  });
}

export function waitForEvent<T>(socket: ClientSocket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

export function waitForDisconnect(socket: ClientSocket, ms = 5000): Promise<string> {
  if (socket.disconnected) return Promise.resolve('already disconnected');
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for disconnect')), ms);
    socket.once('disconnect', (reason) => {
      clearTimeout(t);
      resolve(reason);
    });
  });
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
