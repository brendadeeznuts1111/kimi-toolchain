import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import {
  hashFileSet,
  isFileSetSubset,
  readScopedTestCache,
  scopedTestCachePath,
  shouldSkipTestFastFromScopedCache,
  writeScopedTestCache,
} from "../src/lib/scoped-test-cache.ts";

describe("scoped-test-cache", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = testTempDir("scoped-test-cache-");
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

  test("write and read round-trip", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts", "test/foo.unit.test.ts"], "main");
    const cache = await readScopedTestCache(projectDir);
    expect(cache?.files).toEqual(["src/foo.ts", "test/foo.unit.test.ts"]);
    expect(cache?.baseRef).toBe("main");
    expect(cache?.filesHash).toBe(hashFileSet(["src/foo.ts", "test/foo.unit.test.ts"]));
  });

  test("shouldSkip when staged is subset of cached files at HEAD", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts", "test/a.unit.test.ts"], "main");
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts"])).toBe(true);
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts", "src/new.ts"])).toBe(
      false
    );
  });

  test("shouldSkip false when HEAD changes", async () => {
    await writeScopedTestCache(projectDir, ["src/foo.ts"], "main");
    await Bun.write(join(projectDir, "src/bar.ts"), "export const y = 2;\n");
    await $`git add src/bar.ts`.cwd(projectDir).nothrow().quiet();
    await $`git commit -m second`.cwd(projectDir).nothrow().quiet();
    expect(await shouldSkipTestFastFromScopedCache(projectDir, ["src/foo.ts"])).toBe(false);
  });

  test("isFileSetSubset handles empty staged", () => {
    expect(isFileSetSubset([], ["src/a.ts"])).toBe(true);
    expect(isFileSetSubset(["src/a.ts"], [])).toBe(false);
  });

  test("cache file lives under .kimi", () => {
    expect(scopedTestCachePath(projectDir)).toContain(".kimi/.last-good-scoped-gates");
  });
});
