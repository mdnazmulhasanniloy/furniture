// Runs the e2e web server with the API stub in front of the real API.
//
// The home page is rendered on the server, where Playwright cannot intercept, so the only way to put a
// known "Shop the look" on it is to answer `GET /api/v1/cms/home` while the site is built. The stub does
// that one route and passes everything else through to wherever the API really is (see api-stub.mjs), so
// the rest of the suite sees exactly what it saw before - a running backend on this machine, or an
// unreachable one elsewhere.
//
// It stays up for the whole run, because `next.config.ts` bakes the `/api/*` rewrite target in at build
// time: a stub that stopped after the build would leave the browser's own API calls pointing at a dead port.
//
// Usage: node with-api-stub.mjs "<command to run>"
import { spawn } from "node:child_process";
import { startStub } from "./api-stub.mjs";

const port = Number(process.env.E2E_API_PORT ?? 4310);
await startStub(port); // passes through to the real API_ORIGIN, read before it is overridden below

const child = spawn(process.argv.slice(2).join(" "), {
  shell: true,
  stdio: "inherit",
  env: { ...process.env, API_ORIGIN: `http://127.0.0.1:${port}` },
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
