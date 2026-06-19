import { describe, expect, test } from "bun:test";
import { mergeWatchOptions, mergeWatchTestsOptions } from "../src/lib/check-watch.ts";
import type { CheckOptions } from "../src/lib/check-types.ts";

const base: CheckOptions = {
  dryRun: false,
  fast: false,
  staged: false,
  verbose: false,
  timeoutMs: 1500,
  changedOnly: false,
  base: "main",
  baseExplicit: false,
  failFast: false,
  jsonSummary: false,
  skipTests: false,
  watch: true,
  watchTests: false,
  cacheResults: false,
  noCache: false,
};

describe("check-watch", () => {
  test("mergeWatchOptions implies fast changed-only fail-fast", () => {
    const merged = mergeWatchOptions(base);
    expect(merged.fast).toBe(true);
    expect(merged.changedOnly).toBe(true);
    expect(merged.failFast).toBe(true);
    expect(merged.watch).toBe(false);
    expect(merged.watchTests).toBe(false);
  });

  test("mergeWatchOptions preserves explicit skip-tests", () => {
    const merged = mergeWatchOptions({ ...base, skipTests: true });
    expect(merged.skipTests).toBe(true);
  });

  test("mergeWatchTestsOptions runs changed-only tests without fail-fast", () => {
    const merged = mergeWatchTestsOptions({ ...base, watchTests: true, skipTests: true });
    expect(merged.fast).toBe(true);
    expect(merged.changedOnly).toBe(true);
    expect(merged.failFast).toBe(false);
    expect(merged.skipTests).toBe(false);
    expect(merged.watchTests).toBe(false);
  });
});
