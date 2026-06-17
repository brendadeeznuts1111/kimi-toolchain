import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { $ } from "bun";
import {
  prePushRunsInParallel,
  runConstantDriftGate,
  runPreCommitGates,
} from "../src/lib/hook-gates.ts";
import {
  listStagedPaths,
  shouldSkipTestFastFromScopedCache,
  writeScopedTestCache,
} from "../src/lib/scoped-test-cache.ts";
import { detectSyncDrift } from "../src/lib/sync-hashes.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";
import { testTempDir, withClearedEnv, withEnv, ensureTestDir } from "./helpers.ts";

describe("hook-gates constant drift", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = testTempDir("hook-gates-drift-");
    makeDir(join(projectDir, ".git"), { recursive: true });
    writeText(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "kimi-toolchain", scripts: {} })
    );
  });

  afterEach(() => {
    removePath(projectDir, { recursive: true, force: true });
  });

  function withDriftGate<T>(fn: () => T | Promise<T>): T | Promise<T> {
    return withClearedEnv(["KIMI_SKIP_CONSTANT_DRIFT_GATE"], fn);
  }

  it("should skip gate for non-toolchain repos", async () => {
    await withDriftGate(async () => {
      writeText(
        join(projectDir, "package.json"),
        JSON.stringify({ name: "other-project", scripts: {} })
      );
      const result = await runConstantDriftGate(projectDir);
      expect(result.skipped).toBe(true);
      expect(result.exitCode).toBe(0);
    });
  });

  it("should fail when bunfig drifts from golden", async () => {
    await withDriftGate(async () => {
      writeText(
        join(projectDir, "bunfig.toml"),
        `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`
      );
      await writeConstantsGolden(projectDir);
      writeText(
        join(projectDir, "bunfig.toml"),
        `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "750"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`
      );

      const result = await runConstantDriftGate(projectDir);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("constant drift");
      expect(result.stderr).toContain("KIMI_HOOK_VERIFIER_MAX_CYCLES");
    });
  });

  it("should pass when bunfig matches golden", async () => {
    await withDriftGate(async () => {
      writeText(
        join(projectDir, "bunfig.toml"),
        `
[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.0.0"'
`
      );
      await writeConstantsGolden(projectDir);

      const result = await runConstantDriftGate(projectDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("matches golden");
    });
  });

  it("prePushRunsInParallel defaults true unless KIMI_PRE_PUSH_SERIAL=1", () => {
    withClearedEnv(["KIMI_PRE_PUSH_SERIAL"], () => {
      expect(prePushRunsInParallel()).toBe(true);
      withEnv({ KIMI_PRE_PUSH_SERIAL: "1" }, () => {
        expect(prePushRunsInParallel()).toBe(false);
      });
    });
  });

  it("detectSyncDrift is clean for minimal toolchain stub (no managed sources)", async () => {
    await withDriftGate(async () => {
      writeText(
        join(projectDir, "bunfig.toml"),
        `
[define]
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
`
      );
      await writeConstantsGolden(projectDir);
      const report = await detectSyncDrift(projectDir);
      expect(report.synced).toBe(true);
      expect(report.drifted).toHaveLength(0);
      expect(report.missing).toHaveLength(0);
    });
  });

  it("should skip when golden is missing", async () => {
    await withDriftGate(async () => {
      writeText(
        join(projectDir, "bunfig.toml"),
        `
[define]
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
`
      );

      const result = await runConstantDriftGate(projectDir);
      expect(result.skipped).toBe(true);
      expect(result.exitCode).toBe(0);
    });
  });

  it("pre-commit skips test:fast when scoped test cache covers staged files", async () => {
    await withClearedEnv(["KIMI_HOOK_SUMMARY"], async () => {
      const scopedDir = testTempDir("hook-scoped-pass-");
      await $`git init`.cwd(scopedDir).nothrow().quiet();
      await $`git config user.email test@example.com`.cwd(scopedDir).nothrow().quiet();
      await $`git config user.name Test`.cwd(scopedDir).nothrow().quiet();
      ensureTestDir(join(scopedDir, "src"));
      await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 1;\n");
      writeText(
        join(scopedDir, "package.json"),
        JSON.stringify({
          name: "other-project",
          scripts: {
            "format:check": "true",
            lint: "true",
            typecheck: "true",
            "test:fast": "exit 1",
          },
        })
      );
      await $`git add -A`.cwd(scopedDir).nothrow().quiet();
      await $`git commit -m init`.cwd(scopedDir).nothrow().quiet();

      await writeScopedTestCache(scopedDir, ["src/foo.ts"], "main");
      await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 2;\n");
      await $`git add src/foo.ts`.cwd(scopedDir).nothrow().quiet();

      const staged = await listStagedPaths(scopedDir);
      expect(staged).toEqual(["src/foo.ts"]);
      expect(await shouldSkipTestFastFromScopedCache(scopedDir, staged)).toBe(true);

      const code = await runPreCommitGates(scopedDir);
      expect(code).toBe(0);
      removePath(scopedDir, { recursive: true, force: true });
    });
  });

  it("pre-commit runs test:fast when staged file not in scoped cache", async () => {
    await withClearedEnv(["KIMI_HOOK_SUMMARY"], async () => {
      const scopedDir = testTempDir("hook-scoped-fail-");
      await $`git init`.cwd(scopedDir).nothrow().quiet();
      await $`git config user.email test@example.com`.cwd(scopedDir).nothrow().quiet();
      await $`git config user.name Test`.cwd(scopedDir).nothrow().quiet();
      ensureTestDir(join(scopedDir, "src"));
      await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 1;\n");
      writeText(
        join(scopedDir, "package.json"),
        JSON.stringify({
          name: "other-project",
          scripts: {
            "format:check": "true",
            lint: "true",
            typecheck: "true",
            "test:fast": "exit 1",
          },
        })
      );
      await $`git add -A`.cwd(scopedDir).nothrow().quiet();
      await $`git commit -m init`.cwd(scopedDir).nothrow().quiet();

      await writeScopedTestCache(scopedDir, ["src/foo.ts"], "main");
      await Bun.write(join(scopedDir, "src/other.ts"), "export const z = 3;\n");
      await $`git add src/other.ts`.cwd(scopedDir).nothrow().quiet();

      expect(await shouldSkipTestFastFromScopedCache(scopedDir, ["src/other.ts"])).toBe(false);

      const code = await runPreCommitGates(scopedDir);
      expect(code).toBe(1);
      removePath(scopedDir, { recursive: true, force: true });
    });
  });
});
