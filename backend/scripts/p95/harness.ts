import { performance } from 'node:perf_hooks';

/**
 * Measurement harness for the T-019 p95 check (NFR-02: API p95 < 300 ms for list endpoints at
 * 1k products). Pure helpers so the maths and the measuring loop are unit-testable
 * (`tests/scripts/p95-harness.test.ts`); `scripts/p95-check.ts` does the seeding and orchestration.
 */

export interface EndpointSpec {
  name: string;
  /** Path including query, e.g. `/api/v1/products?limit=24`. */
  path: string;
  headers?: Record<string, string>;
}

export interface EndpointStats {
  name: string;
  path: string;
  samples: number;
  p50: number;
  p95: number;
  max: number;
}

/**
 * Nearest-rank percentile: the smallest value such that at least p% of the data is <= it
 * (rank = ceil(p/100 * n) of the ascending-sorted values). No interpolation — the result is
 * always a latency that actually happened.
 */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of an empty sample');
  if (p <= 0 || p > 100) throw new Error(`percentile out of range: ${p}`);
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1]!;
}

/**
 * Sequential timed requests (sequential on purpose: this measures latency, not throughput).
 * Each sample times the full round trip including reading the body. A non-OK response aborts the
 * run — a 4xx/5xx would "measure" an error page.
 */
export async function measureEndpoint(
  baseUrl: string,
  endpoint: EndpointSpec,
  opts: { warmup: number; samples: number },
): Promise<EndpointStats> {
  const url = baseUrl + endpoint.path;
  const once = async (): Promise<number> => {
    const start = performance.now();
    const res = await fetch(url, { headers: endpoint.headers });
    await res.text();
    const ms = performance.now() - start;
    if (!res.ok) throw new Error(`${endpoint.name}: ${res.status} from ${endpoint.path}`);
    return ms;
  };
  for (let i = 0; i < opts.warmup; i++) await once();
  const timings: number[] = [];
  for (let i = 0; i < opts.samples; i++) timings.push(await once());
  return {
    name: endpoint.name,
    path: endpoint.path,
    samples: timings.length,
    p50: percentileNearestRank(timings, 50),
    p95: percentileNearestRank(timings, 95),
    max: Math.max(...timings),
  };
}

export async function measureEndpoints(
  baseUrl: string,
  endpoints: readonly EndpointSpec[],
  opts: { warmup: number; samples: number },
): Promise<EndpointStats[]> {
  const out: EndpointStats[] = [];
  for (const ep of endpoints) out.push(await measureEndpoint(baseUrl, ep, opts));
  return out;
}

/** Plain-text report; `pass` is true when every endpoint's p95 is under the budget. */
export function formatReport(
  stats: readonly EndpointStats[],
  budgetMs: number,
): { lines: string[]; pass: boolean } {
  const ms = (v: number) => `${v.toFixed(1)} ms`;
  const nameWidth = Math.max(8, ...stats.map((s) => s.name.length));
  const lines = [
    `${'endpoint'.padEnd(nameWidth)}  ${'p50'.padStart(10)}  ${'p95'.padStart(10)}  ${'max'.padStart(10)}  verdict (budget p95 < ${budgetMs} ms)`,
  ];
  let pass = true;
  for (const s of stats) {
    const ok = s.p95 < budgetMs;
    if (!ok) pass = false;
    lines.push(
      `${s.name.padEnd(nameWidth)}  ${ms(s.p50).padStart(10)}  ${ms(s.p95).padStart(10)}  ${ms(s.max).padStart(10)}  ${ok ? 'PASS' : 'FAIL'}`,
    );
  }
  return { lines, pass };
}
