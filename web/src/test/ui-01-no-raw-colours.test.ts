import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UI-01 / CLAUDE.md rule 2: colours come only from the tokens in src/app/globals.css.
// This scans src/ for raw colour literals anywhere else.

const SRC_DIR = path.resolve(import.meta.dirname, "..");
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"]);
const EXCLUDED = new Set([
  path.join(SRC_DIR, "app", "globals.css"), // the token source of truth
  path.join(SRC_DIR, "test"), // this test's own patterns
]);

const HEX_COLOUR = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const RAW_COLOUR_FN = /\b(?:rgba?|hsla?|oklch|oklab)\s*\(/;

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (EXCLUDED.has(full)) return [];
    if (entry.isDirectory()) return collectFiles(full);
    return SCANNED_EXTENSIONS.has(path.extname(entry.name)) ? [full] : [];
  });
}

describe("UI-01: design tokens only", () => {
  it("UI-01: no hex or raw rgb()/hsl()/oklch() colours in src/ outside globals.css", () => {
    const offenders: string[] = [];
    for (const file of collectFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (HEX_COLOUR.test(line) || RAW_COLOUR_FN.test(line)) {
          offenders.push(`${path.relative(SRC_DIR, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `Raw colour literals found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
