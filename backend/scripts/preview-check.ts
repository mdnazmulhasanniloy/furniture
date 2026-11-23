import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';

/**
 * T-026 preview deployment check (NFR-08, ADR-012). Run from `backend/`:
 *
 *     npx tsx scripts/preview-check.ts          # steps 1–4
 *     npx tsx scripts/preview-check.ts --long   # adds step 5 (~6 minutes, needs customer creds)
 *
 * Config comes ONLY from the git-ignored `backend/.env.preview-check`
 * (template `.env.preview-check.example`), never from CLI arguments; secrets are never printed.
 * Ends with `PREVIEW PASS` (exit 0) or `PREVIEW FAIL` (exit 1).
 */

dotenv.config({ path: '.env.preview-check' });

/** Mirrors `SOCKET_PATH` in src/lib/socketServer.ts (not imported: src modules read DATABASE_URL). */
const SOCKET_PATH = '/api/socket-io';
const CONNECT_TIMEOUT_MS = 20_000;
/** --long: vercel.json caps the socket function at 300 s; allow slack before calling it a failure. */
const LONG_MAX_WAIT_MS = 7.5 * 60_000;

const base = (process.env.PREVIEW_URL ?? '').trim().replace(/\/+$/, '');
const bypass = (process.env.VERCEL_PROTECTION_BYPASS ?? '').trim();
const cronSecret = (process.env.CRON_SECRET ?? '').trim();
const long = process.argv.includes('--long');

let failed = false;
const pass = (step: number | string, msg: string) => console.log(`PASS step ${step} — ${msg}`);
const fail = (step: number | string, reason: unknown) => {
  failed = true;
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error(`FAIL step ${step} — ${msg}`);
};

interface ApiResult {
  status: number;
  body: Record<string, unknown> | unknown[] | null;
}

async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: ApiResult['body'] = null;
  try {
    body = (await res.json()) as ApiResult['body'];
  } catch {
    /* non-JSON response (e.g. a protection page) stays null */
  }
  return { status: res.status, body };
}

/** Error detail that is safe to print: status + machine code, never the full body. */
function describe(res: ApiResult): string {
  const code =
    res.body && !Array.isArray(res.body) && typeof res.body.code === 'string' ? res.body.code : '?';
  return `status ${res.status}, code ${code}`;
}

function expectOk(res: ApiResult, what: string, status = 200): Record<string, unknown> {
  if (res.status !== status || res.body === null || Array.isArray(res.body)) {
    throw new Error(`${what} failed (${describe(res)}, expected ${status})`);
  }
  return res.body;
}

async function login(email: string, password: string, who: string) {
  const body = expectOk(
    await api('POST', '/api/v1/auth/login', { body: { email, password } }),
    `${who} login`,
  );
  const token = body.accessToken;
  const user = body.user as Record<string, unknown> | undefined;
  if (typeof token !== 'string' || !user) throw new Error(`${who} login returned no accessToken`);
  return { token, role: String(user.role), id: String(user.id) };
}

/** Decodes the JWT `exp` claim without verifying (the server is the authority; this only times refreshes). */
function tokenExpSeconds(token: string): number {
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : 0;
  } catch {
    return 0;
  }
}

interface TokenSupplier {
  /** The current access token; re-logs-in first when it expires within 60 s (ADR-012 §3). */
  current(): Promise<string>;
}

function tokenSupplier(email: string, password: string, who: string, seed?: string): TokenSupplier {
  let token = seed;
  return {
    async current(): Promise<string> {
      if (!token || tokenExpSeconds(token) - Date.now() / 1000 < 60) {
        console.log(`  ${who}: access token missing or expires within 60 s — logging in again`);
        token = (await login(email, password, who)).token;
      }
      return token;
    },
  };
}

function connectSocket(
  getToken: () => Promise<string>,
  reconnection: boolean,
  label: string,
): ClientSocket {
  const socket = clientIo(base, {
    path: SOCKET_PATH,
    // Vercel routes only the exact function path; requests must be /api/socket-io?EIO=…
    addTrailingSlash: false,
    transports: ['websocket'],
    // A dedicated Manager per check socket. path/addTrailingSlash/transports/extraHeaders are
    // Manager(engine) options and ride along on EVERY reconnect attempt; `auth` is socket-level
    // and, being a function, is re-evaluated before every attempt.
    forceNew: true,
    reconnection,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15_000,
    randomizationFactor: 0.5,
    // ADR-012 §3 contract: auth is a FUNCTION so every (re)connect attempt sends a CURRENT
    // access token, refreshed first when it is near expiry.
    auth: (cb) => {
      getToken().then(
        (token) => cb({ token }),
        (err: unknown) => {
          log(
            label,
            `token refresh failed (${err instanceof Error ? err.message : String(err)}) — attempting without auth`,
          );
          cb({});
        },
      );
    },
    ...(bypass ? { extraHeaders: { 'x-vercel-protection-bypass': bypass } } : {}),
  });
  // Instrumentation: every lifecycle event, timestamped, so a failed --long run shows WHY.
  // Nothing secret is printed (connect_error data is the server's public error payload).
  socket.io.on('reconnect_attempt', (attempt) => log(label, `reconnect_attempt #${attempt}`));
  socket.io.on('reconnect_error', (err) => log(label, `reconnect_error: ${err.message}`));
  socket.io.on('reconnect_failed', () => log(label, 'reconnect_failed (all attempts exhausted)'));
  socket.on('connect', () => log(label, `connect (socket id ${socket.id ?? '?'})`));
  socket.on('connect_error', (err) => log(label, `connect_error: ${describeSocketError(err)}`));
  socket.on('disconnect', (reason) => log(label, `disconnect (reason: ${reason})`));
  return socket;
}

const log = (label: string, msg: string) =>
  console.log(`  [${label} ${new Date().toISOString()}] ${msg}`);

function describeSocketError(err: Error): string {
  const data = (err as Error & { data?: unknown }).data;
  return `${err.message}${data === undefined ? '' : ` data=${JSON.stringify(data)}`}`;
}

function waitFor<T = unknown>(
  socket: ClientSocket,
  event: string,
  ms: number,
  opts: { rejectOnConnectError?: boolean } = {},
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timed out after ${ms} ms waiting for ${event}`)),
      ms,
    );
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
    // While a reconnecting socket retries, transient connect_errors are expected and logged by the
    // instrumentation — pass rejectOnConnectError: false to keep waiting through them.
    if (event !== 'connect_error' && (opts.rejectOnConnectError ?? true)) {
      socket.once('connect_error', (err) => {
        clearTimeout(t);
        reject(new Error(`connect_error: ${describeSocketError(err)}`));
      });
    }
  });
}

/** Step 5 (--long): order + socket gap + missed-notification re-fetch (ADR-012 §3). */
async function longRun(admin: { token: string }): Promise<void> {
  const email = (process.env.PREVIEW_CUSTOMER_EMAIL ?? '').trim();
  const password = process.env.PREVIEW_CUSTOMER_PASSWORD ?? '';
  if (!email || !password) {
    throw new Error('PREVIEW_CUSTOMER_EMAIL / PREVIEW_CUSTOMER_PASSWORD are required for --long');
  }
  const customer = await login(email, password, 'customer');
  if (customer.role !== 'CUSTOMER') throw new Error('PREVIEW_CUSTOMER_EMAIL is not a CUSTOMER');
  const customerToken = tokenSupplier(email, password, 'customer', customer.token);

  // An address in an active city (created once, reused on later runs).
  const addresses = (
    await api('GET', '/api/v1/me/addresses', { token: await customerToken.current() })
  ).body as Record<string, unknown>[] | null;
  let addressId = Array.isArray(addresses) ? (addresses[0]?.id as string | undefined) : undefined;
  if (!addressId) {
    const created = expectOk(
      await api('POST', '/api/v1/me/addresses', {
        token: await customerToken.current(),
        body: {
          label: 'Preview check',
          fullName: 'Preview Check',
          phone: '0512345678',
          cityCode: 'riyadh',
          area: 'Olaya',
          street: 'Preview check street 1',
        },
      }),
      'create address',
      201,
    );
    addressId = String(created.id);
  }

  // A published product with stock (demo seed provides these on preview).
  const list = expectOk(await api('GET', '/api/v1/products?limit=20'), 'list products');
  const product = (list.items as Record<string, unknown>[] | undefined)?.find(
    (p) => typeof p.stock === 'number' && p.stock > 0,
  );
  if (!product) {
    throw new Error(
      'no published product with stock on the preview DB (seed with SEED_DEMO_DATA=true)',
    );
  }

  // Cart with exactly this one line, priced for the chosen address.
  expectOk(
    await api('PUT', '/api/v1/cart/items', {
      token: await customerToken.current(),
      body: { productId: String(product.id), qty: 1 },
    }),
    'put cart item',
  );
  const cart = expectOk(
    await api('GET', `/api/v1/cart?addressId=${addressId}`, {
      token: await customerToken.current(),
    }),
    'price cart',
  );
  const order = expectOk(
    await api('POST', '/api/v1/orders', {
      token: await customerToken.current(),
      headers: { 'idempotency-key': randomUUID() },
      body: { addressId, expectedTotal: cart.total, customerNote: 'preview-check --long (T-026)' },
    }),
    'place order',
    201,
  );
  const orderId = String(order.id);
  console.log(`  --long: placed order ${String(order.orderNo)} (PENDING)`);

  const socket = connectSocket(() => customerToken.current(), true, 'long-socket');
  try {
    await waitFor(socket, 'connect', CONNECT_TIMEOUT_MS);
    const connectedAt = Date.now();
    console.log('  --long: customer socket connected; waiting for the duration-limit close…');

    const reason = await waitFor<string>(socket, 'disconnect', LONG_MAX_WAIT_MS);
    const disconnectSeconds = Math.round((Date.now() - connectedAt) / 1000);
    console.log(
      `  --long: disconnected after ${disconnectSeconds} s (reason: ${reason}) — record this in infra-deployment.md`,
    );

    // Arm the reconnect watcher BEFORE anything else happens: the first automatic reconnect
    // attempt fires ~0.5–1.5 s after the disconnect and can finish before an HTTP round trip —
    // a waiter attached after the admin call misses the 'connect' event entirely (the failure
    // mode of the first --long run: "timed out waiting for connect" with no connect_error).
    let reconnectedAtMs = 0;
    socket.once('connect', () => {
      reconnectedAtMs = Date.now();
    });
    const reconnected = waitFor(socket, 'connect', 60_000, { rejectOnConnectError: false });
    void reconnected.catch(() => undefined); // awaited below; keeps an admin-call throw from leaving it unhandled

    // During the gap (possibly racing the reconnect — the re-fetch assertion holds either way):
    // the admin confirms the order, creating the customer's notification row while offline.
    expectOk(
      await api('PATCH', `/api/v1/admin/orders/${orderId}/status`, {
        token: admin.token,
        body: { status: 'CONFIRMED' },
      }),
      'admin confirm during the gap',
    );
    const confirmDoneAtMs = Date.now();

    await reconnected; // automatic reconnect — the script never calls socket.connect()
    const reconnectSeconds = Math.round((reconnectedAtMs - connectedAt) / 1000) - disconnectSeconds;
    if (reconnectedAtMs <= confirmDoneAtMs) {
      console.log(
        '  --long: note — the reconnect finished before the admin confirm; the notification may also have been delivered live (the re-fetch assertion below is the contract)',
      );
    }
    const notifications = expectOk(
      await api('GET', '/api/v1/notifications', { token: await customerToken.current() }),
      'fetch notifications after reconnect',
    );
    const items = notifications.items as Record<string, unknown>[];
    const missed = items.find(
      (n) =>
        n.type === 'ORDER_STATUS' &&
        (n.data as Record<string, unknown> | null)?.orderId === orderId &&
        n.readAt === null,
    );
    if (!missed) {
      throw new Error(
        'the notification created during the gap was not returned after the reconnect',
      );
    }
    pass(
      5,
      `socket closed by the platform after ${disconnectSeconds} s, auto-reconnected ${reconnectSeconds} s later, missed ORDER_STATUS notification fetched (unread ${String(notifications.unread)})`,
    );
  } finally {
    socket.disconnect();
    // Cleanup, best effort: cancel the check order so stock is restored.
    const cancelled = await api('PATCH', `/api/v1/admin/orders/${orderId}/status`, {
      token: admin.token,
      body: { status: 'CANCELLED', note: 'preview-check --long cleanup (T-026)' },
    });
    console.log(
      cancelled.status === 200
        ? '  --long: check order cancelled (stock restored)'
        : `  --long: could not cancel the check order (${describe(cancelled)}) — cancel it in the admin UI`,
    );
  }
}

async function main(): Promise<void> {
  const email = (process.env.PREVIEW_EMAIL ?? '').trim();
  const password = process.env.PREVIEW_PASSWORD ?? '';
  if (!base || !email || !password) {
    console.error(
      'FAIL step 0 — PREVIEW_URL, PREVIEW_EMAIL and PREVIEW_PASSWORD must be set in backend/.env.preview-check',
    );
    console.log('PREVIEW FAIL');
    process.exit(1);
  }
  console.log(`Checking ${base}${bypass ? ' (with protection bypass)' : ''}`);

  // Step 1: health.
  try {
    const res = await api('GET', '/health');
    if (res.status !== 200 || (res.body as Record<string, unknown> | null)?.status !== 'ok') {
      throw new Error(
        `GET /health answered ${describe(res)}${res.body === null ? ' (non-JSON body — Deployment Protection? set VERCEL_PROTECTION_BYPASS)' : ''}`,
      );
    }
    pass(1, 'GET /health → 200 ok');
  } catch (err) {
    fail(1, err);
  }

  // Step 2: login.
  let session: { token: string; role: string } | undefined;
  if (!failed) {
    try {
      session = await login(email, password, 'primary');
      pass(2, `login → 200 with an access token (role ${session.role})`);
    } catch (err) {
      fail(2, err);
    }
  }

  // Step 3: websocket connect.
  if (session) {
    const sessionToken = session.token;
    const socket = connectSocket(() => Promise.resolve(sessionToken), false, 'step3-socket');
    try {
      await waitFor(socket, 'connect', CONNECT_TIMEOUT_MS);
      pass(3, `websocket connected on ${SOCKET_PATH}`);
    } catch (err) {
      fail(3, err);
    } finally {
      socket.disconnect();
    }
  }

  // Step 4: cron route with the Bearer secret (the scheduled cron itself fires only on production).
  if (!cronSecret) {
    console.log('SKIP step 4 — CRON_SECRET is not set in .env.preview-check');
  } else {
    try {
      const res = await api('GET', '/internal/cron/cleanup', {
        headers: { authorization: `Bearer ${cronSecret}` },
      });
      const counts = expectOk(res, 'cron cleanup');
      const keys = ['otps', 'refreshTokens', 'socketEvents', 'uploads', 'notifications'] as const;
      if (keys.some((k) => typeof counts[k] !== 'number')) {
        throw new Error(`cleanup response is missing counts (${describe(res)})`);
      }
      pass(4, `cron cleanup → 200 (${keys.map((k) => `${k} ${String(counts[k])}`).join(', ')})`);
    } catch (err) {
      fail(4, err);
    }
  }

  // Step 5 (--long): duration-limit disconnect + reconnect + missed-notification re-fetch.
  if (long) {
    if (failed || !session) {
      console.log('SKIP step 5 — earlier steps failed');
    } else if (session.role !== 'ADMIN') {
      fail(5, 'PREVIEW_EMAIL must be an ADMIN for --long (it confirms the order during the gap)');
    } else {
      try {
        await longRun(session);
      } catch (err) {
        fail(5, err);
      }
    }
  }

  console.log(failed ? 'PREVIEW FAIL' : 'PREVIEW PASS');
  process.exit(failed ? 1 : 0);
}

void main();
