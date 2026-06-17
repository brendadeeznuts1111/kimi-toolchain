import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { prePushRunsInParallel, runConstantDriftGate } from "../src/lib/hook-gates.ts";
import { detectSyncDrift } from "../src/lib/sync-hashes.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";
import { testTempDir, withClearedEnv, withEnv } from "./helpers.ts";

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
});
