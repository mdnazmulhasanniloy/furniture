import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag }));

import * as route from "@/app/api/revalidate/route";
import { resetRevalidateLimiter } from "@/lib/revalidate-route";

const SECRET = "s3cret-value-for-tests";
const post = (body: unknown, headers: Record<string, string> = { "x-revalidate-secret": SECRET }, ip = "1.1.1.1") =>
  route.POST(
    new Request("http://localhost/api/revalidate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  process.env.REVALIDATE_SECRET = SECRET;
  revalidateTag.mockClear();
  resetRevalidateLimiter();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ADM-08 · POST /api/revalidate (T-045, B-028)", () => {
  it("ADM-08 · a valid secret and allow-listed tags revalidate each tag once, expiring immediately", async () => {
    const res = await post({ tags: ["home", "products", "settings", "product:oak-table", "page:about", "home"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revalidated: ["home", "products", "settings", "product:oak-table", "page:about"] });
    expect(revalidateTag).toHaveBeenCalledTimes(5);
    expect(revalidateTag).toHaveBeenCalledWith("home", { expire: 0 });
  });

  it("ADM-08 · a wrong secret is 401 with no body and revalidates nothing", async () => {
    const res = await post({ tags: ["home"] }, { "x-revalidate-secret": "nope" });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("ADM-08 · a missing secret header is 401 with no body", async () => {
    const res = await post({ tags: ["home"] }, {});
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("");
  });

  it("ADM-08 · the route fails closed when REVALIDATE_SECRET is unset or empty, even for an empty header", async () => {
    delete process.env.REVALIDATE_SECRET;
    expect((await post({ tags: ["home"] })).status).toBe(401);
    process.env.REVALIDATE_SECRET = "";
    expect((await post({ tags: ["home"] }, { "x-revalidate-secret": "" })).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("ADM-08 · a secret of a different length is rejected without throwing (digests compare equal-length)", async () => {
    expect((await post({ tags: ["home"] }, { "x-revalidate-secret": "x" })).status).toBe(401);
    expect((await post({ tags: ["home"] }, { "x-revalidate-secret": SECRET + SECRET })).status).toBe(401);
  });

  it("ADM-08 · an unknown tag rejects the WHOLE request with 400", async () => {
    for (const bad of ["secrets", "product:", "product:UPPER", "page:a b", "home ", "*", "product:../x", ""]) {
      revalidateTag.mockClear();
      const res = await post({ tags: ["home", bad] });
      expect(res.status, bad).toBe(400);
      expect(revalidateTag, bad).not.toHaveBeenCalled();
    }
  });

  it("ADM-08 · a malformed body is 400: not JSON, no tags, empty list, non-string tag, too many tags, too large", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ tags: [] })).status).toBe(400);
    expect((await post({ tags: [1] })).status).toBe(400);
    expect((await post({ tags: "home" })).status).toBe(400);
    expect((await post({ tags: Array.from({ length: 21 }, (_, i) => `product:p${i}`) })).status).toBe(400);
    expect((await post({ tags: ["home"], pad: "x".repeat(5000) })).status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("ADM-08 · only POST is allowed: every other method is 405 with Allow: POST", () => {
    for (const m of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const) {
      const res = route[m]();
      expect(res.status, m).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("ADM-08 · rate limit: 10 wrong-secret attempts lock the client out with 429, even for the right secret", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ tags: ["home"] }, { "x-revalidate-secret": "bad" })).status).toBe(401);
    const locked = await post({ tags: ["home"] });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(revalidateTag).not.toHaveBeenCalled();
    // another client is not affected
    expect((await post({ tags: ["home"] }, undefined, "2.2.2.2")).status).toBe(200);
  });

  it("ADM-08 · rate limit: more than 60 requests a minute from one client get 429", async () => {
    for (let i = 0; i < 60; i++) expect((await post({ tags: ["home"] })).status).toBe(200);
    expect((await post({ tags: ["home"] })).status).toBe(429);
  });

  it("ADM-08 · the secret is never logged", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await post({ tags: ["home"] });
    await post({ tags: ["bad"] });
    await post({ tags: ["home"] }, { "x-revalidate-secret": "wrong-guess" });
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toMatch(new RegExp(`${SECRET}|wrong-guess`));
  });
});
