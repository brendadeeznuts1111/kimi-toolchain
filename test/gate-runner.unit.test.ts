import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  failMark,
  formatHookSummary,
  formatTestSummaryLine,
  okMark,
  readGateCache,
  shouldSkipGate,
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
  let prevNoColor: string | undefined;

  beforeEach(() => {
    prevNoColor = Bun.env.NO_COLOR;
    delete Bun.env.NO_COLOR;
    projectDir = join(tmpdir(), `gate-runner-${Date.now()}`);
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    mkdirSync(join(projectDir, ".kimi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    if (prevNoColor === undefined) delete Bun.env.NO_COLOR;
    else Bun.env.NO_COLOR = prevNoColor;
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
    await $`git init`.cwd(projectDir).env(gitFixtureEnv).quiet();
    await Bun.write(join(projectDir, "README.md"), "# demo\n");
    await $`git add README.md`
      .cwd(projectDir)
      .env({
        ...gitFixtureEnv,
        GIT_AUTHOR_NAME: "test",
        GIT_AUTHOR_EMAIL: "test@test",
        GIT_COMMITTER_NAME: "test",
        GIT_COMMITTER_EMAIL: "test@test",
      })
      .quiet();
    await $`git commit -m init`
      .cwd(projectDir)
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
