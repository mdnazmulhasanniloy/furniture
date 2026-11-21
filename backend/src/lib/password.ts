import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { getEnv } from '../config/env.js';

/** argon2id with the cost parameters from env (ADR-011). */
export function hashPassword(password: string): Promise<string> {
  const env = getEnv();
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
}

let dummyHash: Promise<string> | undefined;

/** Spends one argon2 verify so a missing account costs the same time as a wrong password. */
export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(
    await (dummyHash ??= hashPassword(randomBytes(16).toString('hex'))),
    password,
  );
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}
