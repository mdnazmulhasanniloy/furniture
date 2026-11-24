import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CR-011 review item 3: delivery covers only the active cities, so no storefront copy may claim the whole country.
const FORBIDDEN = /across (?:all )?saudi|all (?:saudi )?cities|nationwide|every city|أنحاء|جميع مدن|كل مدن|جميع المدن|كل المدن|مدننا/i;
describe("UI-04 · no all-of-Saudi delivery claims in the storefront copy", () => {
  for (const locale of ["en", "ar"]) {
    it(`UI-04 · messages/${locale}.json has none (${locale})`, () => {
      const raw = readFileSync(path.resolve(import.meta.dirname, "..", "..", "messages", `${locale}.json`), "utf8");
      const hits = raw.split("\n").filter((l) => FORBIDDEN.test(l));
      expect(hits).toEqual([]);
    });
  }
});
