import { Emitter } from '@socket.io/mongo-emitter';
import type { Collection, Document } from 'mongodb';
import { getEnv } from '../config/env.js';
import { createLogger, type Logger } from './logger.js';
import { adapterCollection } from './mongo.js';

/**
 * REST-side Socket.IO emitter (ADR-012, T-023): writes adapter documents to MongoDB so the event reaches
 * whichever instance holds the socket. Emitting is best effort — the Notification row is the source of
 * truth — so a failed emit is logged and NEVER fails or crashes the request.
 */

let log: Logger | undefined;
const logger = () => (log ??= createLogger(getEnv()));

/**
 * `Emitter` calls `insertOne` without awaiting it, so a MongoDB outage would surface as an unhandled
 * rejection and kill the process. This facade catches and logs instead (key fields only, never payloads:
 * notification bodies are user-facing data and the redaction list does not know their shape).
 */
function guardedCollection(col: Collection<Document>): Pick<Collection<Document>, 'insertOne'> {
  return {
    insertOne: (doc, options) =>
      col.insertOne(doc, options).catch((err: unknown) => {
        logger().error({ err }, 'socket emit failed; event not delivered live');
        return { acknowledged: false, insertedId: doc._id! };
      }),
  };
}

let emitter: Emitter | undefined;
const getEmitter = (): Emitter =>
  // `addCreatedAtField` so emitter documents are swept by the TTL index like the adapter's own.
  (emitter ??= new Emitter(guardedCollection(adapterCollection()), undefined, {
    addCreatedAtField: true,
  }));

export const socketEmitter = {
  /** NOTIF-01: emit to one signed-in user's sockets (room `user:{id}`), on any instance. */
  toUser(userId: string) {
    return getEmitter().to(`user:${userId}`);
  },
  /** NOTIF-02: emit to all online admins (room `admins`). */
  toAdmins() {
    return getEmitter().to('admins');
  },
  /**
   * Force-close every live socket of a user, across instances. Used when the user's sessions are revoked:
   * password reset (T-006), refresh-token reuse detection (T-005) and admin block (T-017).
   */
  disconnectUser(userId: string): void {
    getEmitter().in(`user:${userId}`).disconnectSockets(true);
  },
};

/** Test hook: forget the memoized Emitter (e.g. after `closeMongoClient`). */
export function resetEmitterMemo(): void {
  emitter = undefined;
}
