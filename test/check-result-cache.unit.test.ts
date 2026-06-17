import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import {
  computeCheckCacheKey,
  loadCheckCache,
  saveCheckCache,
  checkCachePath,
  projectScopeKey,
} from "../src/lib/check-result-cache.ts";
import type { CheckOptions, CheckRunResult } from "../src/lib/check-types.ts";

const baseOptions: CheckOptions = {
  dryRun: false,
  fast: true,
  staged: false,
  verbose: false,
  timeoutMs: 1500,
  changedOnly: false,
  base: "main",
  baseExplicit: false,
  failFast: false,
  jsonSummary: false,
  skipTests: false,
  watch: false,
  watchTests: false,
  cacheResults: true,
  noCache: false,
};

const sampleResult: CheckRunResult = {
  passed: true,
  steps: { "format:check": { passed: true, durationMs: 10 } },
  failures: [],
  totalDurationMs: 10,
};

describe("check-result-cache", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = testTempDir("check-cache-");
    await $`git init`.cwd(projectDir).nothrow().quiet();
    await $`git config user.email test@example.com`.cwd(projectDir).nothrow().quiet();
    await $`git config user.name Test`.cwd(projectDir).nothrow().quiet();
    ensureTestDir(join(projectDir, "src"));
    await Bun.write(join(projectDir, "src/foo.ts"), "export const x = 1;\n");
    await $`git add src/foo.ts`.cwd(projectDir).nothrow().quiet();
    await $`git commit -m init`.cwd(projectDir).nothrow().quiet();
  });

  afterEach(() => {
    cleanupPath(projectDir);
  });

  test("save and load round-trip", async () => {
    const key = await computeCheckCacheKey(projectDir, baseOptions);
    expect(key).toBeTruthy();
    await saveCheckCache(projectDir, key!, sampleResult);
    const loaded = await loadCheckCache(projectDir, key!);
    expect(loaded?.passed).toBe(true);
    expect(loaded?.fromCache).toBe(true);
  });

  test("load returns null on key mismatch", async () => {
    const key = await computeCheckCacheKey(projectDir, baseOptions);
    await saveCheckCache(projectDir, key!, sampleResult);
    expect(await loadCheckCache(projectDir, "wrong-key")).toBeNull();
  });

  test("key changes when file content changes", async () => {
    const key1 = await computeCheckCacheKey(projectDir, baseOptions);
    await Bun.write(join(projectDir, "src/foo.ts"), "export const x = 2;\n");
    const key2 = await computeCheckCacheKey(projectDir, baseOptions);
    expect(key1).not.toBe(key2);
  });

  test("key changes when tooling config changes", async () => {
    const key1 = await computeCheckCacheKey(projectDir, baseOptions);
    await Bun.write(join(projectDir, "dx.config.toml"), "version = 1\n");
    const key2 = await computeCheckCacheKey(projectDir, baseOptions);
    expect(key1).not.toBe(key2);
  });

  test("multi-project entries share one cache file", async () => {
    const key = await computeCheckCacheKey(projectDir, baseOptions);
    await saveCheckCache(projectDir, key!, sampleResult);

    const scope = await projectScopeKey(projectDir);
    const raw = JSON.parse(await Bun.file(checkCachePath(projectDir)).text());
    expect(raw.version).toBe(2);
    expect(raw.entries[scope].result.passed).toBe(true);
    expect(raw.entries[scope].key).toBe(key);
  });

  test("corrupt cache file returns null", async () => {
    ensureTestDir(join(projectDir, ".kimi"));
    await Bun.write(checkCachePath(projectDir), "{not json");
    expect(await loadCheckCache(projectDir, "any")).toBeNull();
  });
});
