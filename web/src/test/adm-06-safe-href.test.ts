import { describe, expect, it } from "vitest";
import { safeHref } from "@/lib/home";

describe("ADM-06 · safeHref rejects protocol-relative tricks", () => {
  it.each(["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\u0000/evil.com", "//evil.com", "/\\evil.com", "javascript:alert(1)", "http://x.com"])(
    "rejects %j",
    (v) => expect(safeHref(v)).toBeNull(),
  );
  it("keeps same-site paths and https URLs", () => {
    expect(safeHref("/shop?type=new")).toEqual({ href: "/shop?type=new", external: false });
    expect(safeHref("https://example.com/x")?.external).toBe(true);
  });
});
