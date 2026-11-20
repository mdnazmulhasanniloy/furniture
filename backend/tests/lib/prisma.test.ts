import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/lib/prisma.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('prisma', () => {
  it('NFR-05 · PrismaClient is a globalThis singleton across module reloads', async () => {
    vi.resetModules();
    const again = await import('../../src/lib/prisma.js');
    expect(again.prisma).toBe(prisma);
  });

  it('NFR-05 · connects to the MongoDB replica set', async () => {
    const res = (await prisma.$runCommandRaw({ ping: 1 })) as { ok: number };
    expect(res.ok).toBe(1);
    const hello = (await prisma.$runCommandRaw({ hello: 1 })) as { setName?: string };
    expect(hello.setName).toBeTruthy();
  });
});
