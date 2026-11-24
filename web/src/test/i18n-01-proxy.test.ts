import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import proxy from "@/proxy";

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost:3100${path}`, { headers });

describe("I18N-01 · proxy locale redirect", () => {
  it("/ with no cookie goes to /ar even when the browser prefers English", () => {
    const res = proxy(req("/", { "accept-language": "en-US,en;q=0.9" }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ar");
  });
  it("keeps the query string", () => {
    const res = proxy(req("/?utm=1"));
    expect(new URL(res.headers.get("location")!).search).toBe("?utm=1");
  });
  it("NEXT_LOCALE=en sends / to /en", () => {
    const res = proxy(req("/", { cookie: "NEXT_LOCALE=en" }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/en");
  });
  it("an invalid NEXT_LOCALE value still lands on /ar, not the browser language", () => {
    const res = proxy(req("/", { cookie: "NEXT_LOCALE=fr", "accept-language": "en" }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ar");
  });
  it("an empty NEXT_LOCALE value still lands on /ar", () => {
    const res = proxy(req("/", { cookie: "NEXT_LOCALE=", "accept-language": "en" }));
    expect(new URL(res.headers.get("location")!).pathname).toBe("/ar");
  });
});
