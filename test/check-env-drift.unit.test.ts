import { describe, expect, test } from "bun:test";
import { parseEnvKeys, computeDrift, applyFix, formatDrift } from "../src/lib/check-env-drift.ts";

describe("check-env-drift", () => {
  test("parseEnvKeys skips comments and blanks", () => {
    const text = `
# comment
FOO=bar

BAZ=qux
# another comment
  SPACES = trimmed
INVALID_NO_EQUALS
`;
    const keys = parseEnvKeys(text);
    expect(Array.from(keys).sort()).toEqual(["BAZ", "FOO", "SPACES"]);
  });

  test("computeDrift reports example-only and local-only keys", () => {
    const example = new Set(["A", "B", "C"]);
    const local = new Set(["B", "C", "D"]);
    const drift = computeDrift(example, local);
    expect(drift.exampleOnly).toEqual(["A"]);
    expect(drift.localOnly).toEqual(["D"]);
    expect(drift.exampleTotal).toBe(3);
    expect(drift.localTotal).toBe(3);
  });

  test("computeDrift returns empty when in sync", () => {
    const set = new Set(["X", "Y"]);
    const drift = computeDrift(set, set);
    expect(drift.exampleOnly).toEqual([]);
    expect(drift.localOnly).toEqual([]);
    expect(drift.exampleTotal).toBe(2);
    expect(drift.localTotal).toBe(2);
  });

  test("applyFix appends missing keys with their comments", () => {
    const example = `
# App config
API_KEY=xxx

# Server config
PORT=3000
`;
    const local = "API_KEY=yyy\n";
    const drift = computeDrift(parseEnvKeys(example), parseEnvKeys(local));
    const fixed = applyFix(drift, example, local);

    expect(fixed).toContain("API_KEY=yyy");
    expect(fixed).toContain("PORT=3000");
    expect(fixed).toContain("Synchronized from .env.example");
    // The missing block should include its preceding comment.
    expect(fixed).toContain("# Server config");
  });

  test("applyFix is a no-op when there is no example-only drift", () => {
    const local = "API_KEY=yyy\n";
    const drift = computeDrift(parseEnvKeys(local), parseEnvKeys(local));
    expect(applyFix(drift, local, local)).toBe(local);
  });

  test("formatDrift reports sync status", () => {
    const drift = computeDrift(new Set(["A"]), new Set(["A"]));
    const formatted = formatDrift(drift);
    expect(formatted).toContain("in sync");
    expect(formatted).toContain(".env.example keys: 1");
  });

  test("formatDrift lists missing and local-only keys", () => {
    const drift = computeDrift(new Set(["A", "B"]), new Set(["B", "C"]));
    const formatted = formatDrift(drift);
    expect(formatted).toContain("Missing from .env");
    expect(formatted).toContain("- A");
    expect(formatted).toContain("Local-only in .env");
    expect(formatted).toContain("- C");
  });
});
