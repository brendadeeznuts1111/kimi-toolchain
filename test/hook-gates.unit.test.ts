import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import {
  planPreCommitTestArgs,
  prePushRunsInParallel,
  runConstantDriftGate,
  runPortalConvergenceGate,
  runPreCommitGates,
} from "../src/lib/hook-gates.ts";
import {
  listStagedPaths,
  shouldSkipTestFastFromScopedCache,
  writeScopedTestCache,
} from "../src/lib/scoped-test-cache.ts";
import { detectSyncDrift } from "../src/lib/sync-hashes.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";
import { GIT_LOCAL_ENV_KEYS } from "../src/lib/tool-runner.ts";
import { readableStreamToText } from "../src/lib/bun-utils.ts";
import { testTempDir, withClearedEnv, withEnv, ensureTestDir } from "./helpers.ts";

/** Git init + pre-commit gate subprocesses need headroom under parallel test:changed. */
const PRE_COMMIT_GATE_TEST_MS = 30_000;
const GIT_LOCAL_ENV_KEY_SET = new Set<string>(GIT_LOCAL_ENV_KEYS);

function scrubbedGitFixtureEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(Bun.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !GIT_LOCAL_ENV_KEY_SET.has(entry[0])
    )
  );
}

async function runFixtureGit(projectRoot: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: projectRoot,
    env: scrubbedGitFixtureEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    readableStreamToText(proc.stdout),
    readableStreamToText(proc.stderr),
    proc.exited,
  ]);
  expect({ args, stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
}

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

  it("should skip portal gate for non-toolchain repos", async () => {
    writeText(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "other-project", scripts: {} })
    );
    const result = await runPortalConvergenceGate(projectDir);
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("prePushRunsInParallel defaults true unless KIMI_PRE_PUSH_SERIAL=1", () => {
    withClearedEnv(["KIMI_PRE_PUSH_SERIAL"], () => {
      expect(prePushRunsInParallel()).toBe(true);
      withEnv({ KIMI_PRE_PUSH_SERIAL: "1" }, () => {
        expect(prePushRunsInParallel()).toBe(false);
      });
    });
  });

  it("pre-commit runs staged test files directly before falling back to changed graph", () => {
    const direct = planPreCommitTestArgs(["README.md", "test/foo.unit.test.ts"]);
    expect(direct.usesChangedRef).toBe(false);
    expect(direct.stagedTestFiles).toEqual(["test/foo.unit.test.ts"]);
    expect(direct.args).toContain("--isolate");
    expect(direct.args).toContain("test/foo.unit.test.ts");
    expect(direct.args).not.toContain("--changed=HEAD");

    const mini = planPreCommitTestArgs([
      "examples/dashboard/thresholds.json",
      "scripts/bootstrap-git-ssh.sh",
      "test/bunfig-policy-gate.unit.test.ts",
    ]);
    expect(mini.skip).toBeUndefined();
    expect(mini.usesChangedRef).toBe(false);
    expect(mini.stagedTestFiles).toEqual(["test/bunfig-policy-gate.unit.test.ts"]);
    expect(mini.args).toContain("test/bunfig-policy-gate.unit.test.ts");

    const dataOnly = planPreCommitTestArgs(["examples/dashboard/thresholds.json"]);
    expect(dataOnly.skip).toBe(true);
    expect(dataOnly.args).toEqual([]);

    const mixed = planPreCommitTestArgs(["src/lib/foo.ts", "test/foo.unit.test.ts"]);
    expect(mixed.usesChangedRef).toBe(true);
    expect(mixed.stagedTestFiles).toEqual(["test/foo.unit.test.ts"]);
    expect(mixed.args).toContain("--changed=HEAD");

    const changed = planPreCommitTestArgs(["src/lib/foo.ts"]);
    expect(changed.usesChangedRef).toBe(true);
    expect(changed.stagedTestFiles).toEqual([]);
    expect(changed.args).toContain("--changed=HEAD");
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

  describe.serial("pre-commit subprocess gates", () => {
    it(
      "pre-commit skips test:fast when scoped test cache covers staged files",
      async () => {
        await withClearedEnv(["KIMI_HOOK_SUMMARY"], async () => {
          const scopedDir = testTempDir("hook-scoped-pass-");
          await runFixtureGit(scopedDir, ["init"]);
          await runFixtureGit(scopedDir, ["config", "user.email", "test@example.com"]);
          await runFixtureGit(scopedDir, ["config", "user.name", "Test"]);
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
          await runFixtureGit(scopedDir, ["add", "-A"]);
          await runFixtureGit(scopedDir, ["commit", "-m", "init"]);

          await writeScopedTestCache(scopedDir, ["src/foo.ts"], "main");
          await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 2;\n");
          await runFixtureGit(scopedDir, ["add", "src/foo.ts"]);

          const staged = await listStagedPaths(scopedDir);
          expect(staged).toEqual(["src/foo.ts"]);
          expect(await shouldSkipTestFastFromScopedCache(scopedDir, staged)).toBe(true);

          const code = await runPreCommitGates(scopedDir);
          expect(code).toBe(0);
          removePath(scopedDir, { recursive: true, force: true });
        });
      },
      PRE_COMMIT_GATE_TEST_MS
    );

    it(
      "pre-commit runs canonical references check when script exists",
      async () => {
        await withClearedEnv(["KIMI_HOOK_SUMMARY"], async () => {
          const scopedDir = testTempDir("hook-canonical-check-");
          await runFixtureGit(scopedDir, ["init"]);
          await runFixtureGit(scopedDir, ["config", "user.email", "test@example.com"]);
          await runFixtureGit(scopedDir, ["config", "user.name", "Test"]);
          ensureTestDir(join(scopedDir, "src"));
          makeDir(join(scopedDir, "scripts"), { recursive: true });
          await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 1;\n");
          writeText(
            join(scopedDir, "scripts/generate-canonical-references.ts"),
            "await Bun.write('canonical-ran.txt', 'yes\\n');\n"
          );
          writeText(
            join(scopedDir, "package.json"),
            JSON.stringify({
              name: "other-project",
              scripts: {
                "format:check": "true",
                lint: "true",
                typecheck: "true",
                "test:fast": "true",
              },
            })
          );
          await runFixtureGit(scopedDir, ["add", "-A"]);
          await runFixtureGit(scopedDir, ["commit", "-m", "init"]);
          await Bun.write(join(scopedDir, "src/foo.ts"), "export const x = 2;\n");
          await runFixtureGit(scopedDir, ["add", "src/foo.ts"]);

          const code = await runPreCommitGates(scopedDir);

          expect(code).toBe(0);
          expect(await Bun.file(join(scopedDir, "canonical-ran.txt")).text()).toBe("yes\n");
          removePath(scopedDir, { recursive: true, force: true });
        });
      },
      PRE_COMMIT_GATE_TEST_MS
    );

    it(
      "pre-commit skips test:fast when bun test --changed finds no matching tests",
      async () => {
        await withClearedEnv(["KIMI_HOOK_SUMMARY"], async () => {
          const scopedDir = testTempDir("hook-scoped-fail-");
          await runFixtureGit(scopedDir, ["init"]);
          await runFixtureGit(scopedDir, ["config", "user.email", "test@example.com"]);
          await runFixtureGit(scopedDir, ["config", "user.name", "Test"]);
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
                "test:fast": "true",
              },
            })
          );
          await runFixtureGit(scopedDir, ["add", "-A"]);
          await runFixtureGit(scopedDir, ["commit", "-m", "init"]);

          await writeScopedTestCache(scopedDir, ["src/foo.ts"], "main");
          await Bun.write(join(scopedDir, "src/other.ts"), "export const z = 3;\n");
          await runFixtureGit(scopedDir, ["add", "src/other.ts"]);

          // src/other.ts is not in scoped cache, so cache skip won't trigger.
          // bun test --changed=HEAD with 0 matching test files must skip (not fail).
          // Matcher: isBunTestChangedEmptyOutput — Bun message strings drift across versions.
          expect(await shouldSkipTestFastFromScopedCache(scopedDir, ["src/other.ts"])).toBe(false);

          const code = await runPreCommitGates(scopedDir);
          expect(code).toBe(0);
          removePath(scopedDir, { recursive: true, force: true });
        });
      },
      PRE_COMMIT_GATE_TEST_MS
    );
  });
});
