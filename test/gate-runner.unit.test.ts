import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import { cleanupPath, ensureTestDir, REPO_ROOT, testTempDir } from "./helpers.ts";
import {
  failMark,
  formatHookSummary,
  formatTestSummaryLine,
  okMark,
  readGateCache,
  shouldSkipGate,
  appendGateCache,
  writeGateCache,
} from "../src/lib/gate-runner.ts";

const gitFixtureEnv = {
  GIT_DIR: undefined,
  GIT_WORK_TREE: undefined,
  GIT_INDEX_FILE: undefined,
  GIT_PREFIX: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  LEFTHOOK: "0",
};

describe("gate-runner", () => {
  let projectDir: string;
  let previousNoColor: string | undefined;

  beforeEach(() => {
    previousNoColor = Bun.env.NO_COLOR;
    delete Bun.env.NO_COLOR;
    projectDir = testTempDir("gate-runner-");
    ensureTestDir(join(projectDir, ".kimi"));
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(REPO_ROOT);
    cleanupPath(projectDir);
    if (previousNoColor === undefined) delete Bun.env.NO_COLOR;
    else Bun.env.NO_COLOR = previousNoColor;
  });

  it("should format hook summary with skipped gates", () => {
    const line = formatHookSummary("pre-push", [
      { name: "format:check", exitCode: 0, ms: 100, stdout: "", stderr: "", skipped: true },
      { name: "lint", exitCode: 0, ms: 200, stdout: "", stderr: "" },
    ]);
    expect(line).toContain("[pre-push]");
    expect(line).toContain("↷fmt");
    expect(line).toContain("✓lint");
  });

  it("should format test summary line from bun output", () => {
    const line = formatTestSummaryLine("419 pass\n0 fail\nRan 419 tests across 48 files. [2.5s]");
    expect(line).toContain("419 passed");
    expect(line).toContain("48 files");
  });

  it("should cache and skip gates for the same commit", async () => {
    await $`git init`.env(gitFixtureEnv).quiet();
    await Bun.write(join(projectDir, "README.md"), "# demo\n");
    await $`git add README.md`
      .env({
        ...gitFixtureEnv,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      })
      .quiet();
    await $`git commit -m init`
      .env({
        ...gitFixtureEnv,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      })
      .quiet();

    await writeGateCache(projectDir, ["format:check", "lint"]);
    const cache = await readGateCache(projectDir);
    expect(cache?.gates).toEqual(["format:check", "lint"]);

    expect(await shouldSkipGate(projectDir, "format:check")).toBe(true);
    expect(await shouldSkipGate(projectDir, "typecheck")).toBe(false);
  });

  it("appendGateCache merges gates for the same commit", async () => {
    await $`git init`.env(gitFixtureEnv).quiet();
    await Bun.write(join(projectDir, "README.md"), "# demo\n");
    await $`git add README.md`
      .env({
        ...gitFixtureEnv,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      })
      .quiet();
    await $`git commit -m init`
      .env({
        ...gitFixtureEnv,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      })
      .quiet();

    await writeGateCache(projectDir, ["format:check", "lint"]);
    await appendGateCache(projectDir, ["guardian", "workspace-verify"]);
    const cache = await readGateCache(projectDir);
    expect(cache?.gates).toEqual(["format:check", "lint", "guardian", "workspace-verify"]);
  });

  it("uses plain marks when NO_COLOR is set", () => {
    Bun.env.NO_COLOR = "1";
    expect(failMark()).toBe("FAIL");
    expect(okMark()).toBe("OK");
    const line = formatHookSummary("pre-push", [
      { name: "lint", exitCode: 0, ms: 1, stdout: "", stderr: "" },
      { name: "check", exitCode: 1, ms: 1, stdout: "", stderr: "" },
    ]);
    expect(line).toContain("OKlint");
    expect(line).toContain("FAILcheck");
  });
});
