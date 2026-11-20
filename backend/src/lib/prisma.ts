import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { __furnixaPrisma?: PrismaClient };

/** One PrismaClient per instance (ADR-012): reused across hot reloads and warm serverless invocations. */
export const prisma: PrismaClient = (g.__furnixaPrisma ??= new PrismaClient());
