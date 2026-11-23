import type { Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatReport,
  measureEndpoint,
  measureEndpoints,
  percentileNearestRank,
} from '../../scripts/p95/harness.js';

/**
 * T-019 (NFR-02): the measurement harness behind `npm run p95`. The real < 300 ms gate at 1k
 * products is the owner-run script (`scripts/p95-check.ts`, in-memory and Atlas modes, approved
 * 2026-11-23); here the maths and the measuring loop are proven exact.
 */

describe('NFR-02 · nearest-rank percentile math is exact', () => {
  it('NFR-02 · nearest-rank percentile math is exact', () => {
    const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentileNearestRank(oneToHundred, 95)).toBe(95);
    expect(percentileNearestRank(oneToHundred, 50)).toBe(50);
    expect(percentileNearestRank(oneToHundred, 100)).toBe(100);
    // Unsorted input is sorted internally.
    expect(percentileNearestRank([30, 10, 20], 50)).toBe(20);
    // rank = ceil(0.95 * 3) = 3 -> the largest of three.
    expect(percentileNearestRank([30, 10, 20], 95)).toBe(30);
    expect(percentileNearestRank([7], 95)).toBe(7);
    // The result is always a value that actually occurred (no interpolation).
    expect([10, 20, 30]).toContain(percentileNearestRank([10, 20, 30], 75));
    expect(() => percentileNearestRank([], 95)).toThrow(/empty/);
    expect(() => percentileNearestRank([1], 0)).toThrow(/range/);
    expect(() => percentileNearestRank([1], 101)).toThrow(/range/);
  });
});

describe('NFR-02 · p95 measurement harness', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express();
    app.get('/fast', (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/slow', (_req, res) => {
      setTimeout(() => res.json({ ok: true }), 30);
    });
    app.get('/secured', (req, res) => {
      if (req.headers.authorization !== 'Bearer p95-token') {
        res.status(401).json({ code: 'UNAUTHORIZED' });
        return;
      }
      res.json({ ok: true });
    });
    app.get('/broken', (_req, res) => {
      res.status(500).json({ code: 'INTERNAL_ERROR' });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('NFR-02 · the p95 harness measures the running app and reports per-endpoint stats', async () => {
    const stats = await measureEndpoints(
      baseUrl,
      [
        { name: 'fast', path: '/fast' },
        { name: 'slow', path: '/slow' },
        { name: 'secured', path: '/secured', headers: { Authorization: 'Bearer p95-token' } },
      ],
      { warmup: 2, samples: 10 },
    );
    expect(stats.map((s) => s.name)).toEqual(['fast', 'slow', 'secured']);
    for (const s of stats) {
      expect(s.samples).toBe(10);
      expect(s.p50).toBeGreaterThan(0);
      expect(s.p95).toBeGreaterThanOrEqual(s.p50);
      expect(s.max).toBeGreaterThanOrEqual(s.p95);
    }
    const slow = stats.find((s) => s.name === 'slow')!;
    const fast = stats.find((s) => s.name === 'fast')!;
    // The 30 ms endpoint must measure at or above its artificial delay. Scheduling noise under
    // parallel test forks can only ADD time, so this lower bound can never flake; an ordering
    // like `fast.p95 < slow.p95` can (with 10 samples, nearest-rank p95 IS the max, and one
    // >100 ms stall on a fast sample once pushed it above slow's — flake found 2026-11-23).
    // Attribution bugs stay caught without comparing noisy tails: stats swapped between the two
    // endpoints fail the 25 ms bound; one shared stats object fails the identity check (two
    // independent sub-ms float measurements are never bit-identical).
    expect(slow.p95).toBeGreaterThanOrEqual(25);
    expect(fast.p95).not.toBe(slow.p95);

    // formatReport flags a busted budget and passes a generous one (the real budget is the script's 300 ms).
    const tight = formatReport(stats, 20);
    expect(tight.pass).toBe(false);
    expect(tight.lines.join('\n')).toContain('FAIL');
    const generous = formatReport(stats, 10_000);
    expect(generous.pass).toBe(true);
    expect(generous.lines.join('\n')).not.toContain('FAIL');
  });

  it('NFR-02 · a non-2xx response aborts the measurement instead of timing an error page', async () => {
    await expect(
      measureEndpoint(baseUrl, { name: 'broken', path: '/broken' }, { warmup: 0, samples: 2 }),
    ).rejects.toThrow(/broken: 500/);
    // An auth'd endpoint without its header is a 401, not a sample.
    await expect(
      measureEndpoint(baseUrl, { name: 'secured', path: '/secured' }, { warmup: 0, samples: 2 }),
    ).rejects.toThrow(/secured: 401/);
  });
});
