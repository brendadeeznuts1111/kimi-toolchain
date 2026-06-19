import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { cleanupPath, ensureTestDir, testTempDir } from "./helpers.ts";
import {
  SCOPED_ANY_TS,
  allPreCommitGatesCoveredAtHead,
  hashFileSet,
  isGateCoveredAtHead,
  readScopedGateCache,
  scopedGateCachePath,
  shouldSkipGateFromScopedCache,
  writeScopedGatePass,
} from "../src/lib/scoped-gate-cache.ts";

describe("scoped-gate-cache", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = testTempDir("scoped-gate-cache-");
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

  test("writeScopedGatePass merges gates at same commit", async () => {
    const branch = ["src/foo.ts", "test/a.unit.test.ts"];
    await writeScopedGatePass(projectDir, "format:check", ["src/foo.ts"], "main", branch);
    await writeScopedGatePass(projectDir, "lint", branch, "main", branch);

    const cache = await readScopedGateCache(projectDir);
    expect(cache?.gates["format:check"]?.files).toEqual(["src/foo.ts"]);
    expect(cache?.gates.lint?.files).toEqual(branch);
    expect(cache?.branchDiffFiles).toEqual(branch);
  });

  test("shouldSkipGateFromScopedCache uses branch diff for typecheck *", async () => {
    const branch = ["src/foo.ts", "docs/readme.md"];
    await writeScopedGatePass(projectDir, "typecheck", [SCOPED_ANY_TS], "main", branch);

    expect(await shouldSkipGateFromScopedCache(projectDir, "typecheck", ["src/foo.ts"])).toBe(true);
    expect(await shouldSkipGateFromScopedCache(projectDir, "typecheck", ["src/other.ts"])).toBe(
      false
    );
  });

  test("isGateCoveredAtHead true when scoped gate recorded", async () => {
    await writeScopedGatePass(projectDir, "lint", ["src/foo.ts"], "main", ["src/foo.ts"]);
    expect(await isGateCoveredAtHead(projectDir, "lint")).toBe(true);
    expect(await isGateCoveredAtHead(projectDir, "format:check")).toBe(false);
  });

  test("allPreCommitGatesCoveredAtHead when all four gates recorded", async () => {
    const files = ["src/foo.ts"];
    await writeScopedGatePass(projectDir, "format:check", files, "main", files);
    await writeScopedGatePass(projectDir, "lint", files, "main", files);
    await writeScopedGatePass(projectDir, "typecheck", [SCOPED_ANY_TS], "main", files);
    await writeScopedGatePass(projectDir, "test:fast", files, "main", files);

    expect(await allPreCommitGatesCoveredAtHead(projectDir)).toBe(true);
  });

  test("cache path under .kimi", () => {
    expect(scopedGateCachePath(projectDir)).toContain(".last-good-scoped-gates");
  });

  test("hashFileSet is stable", () => {
    expect(hashFileSet(["b.ts", "a.ts"])).toBe(hashFileSet(["a.ts", "b.ts"]));
  });
});
