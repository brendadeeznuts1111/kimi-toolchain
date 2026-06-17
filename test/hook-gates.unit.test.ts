import { makeDir, removePath, writeText } from "../src/lib/bun-io.ts";

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { prePushRunsInParallel, runConstantDriftGate } from "../src/lib/hook-gates.ts";
import { detectSyncDrift } from "../src/lib/sync-hashes.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";

import { testTempDir } from "./helpers.ts";
describe("hook-gates constant drift", () => {
  let projectDir: string;
  let previousSkip: string | undefined;

  beforeEach(() => {
    previousSkip = Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    delete Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    projectDir = testTempDir("hook-gates-drift-");
    makeDir(join(projectDir, ".git"), { recursive: true });
    writeText(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "kimi-toolchain", scripts: {} })
    );
  });

  afterEach(() => {
    if (previousSkip === undefined) delete Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    else Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE = previousSkip;
    removePath(projectDir, { recursive: true, force: true });
  });

  it("should skip gate for non-toolchain repos", async () => {
    writeText(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "other-project", scripts: {} })
    );
    const result = await runConstantDriftGate(projectDir);
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("should fail when bunfig drifts from golden", async () => {
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

  it("should pass when bunfig matches golden", async () => {
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

  it("prePushRunsInParallel defaults true unless KIMI_PRE_PUSH_SERIAL=1", () => {
    const previous = Bun.env.KIMI_PRE_PUSH_SERIAL;
    delete Bun.env.KIMI_PRE_PUSH_SERIAL;
    expect(prePushRunsInParallel()).toBe(true);
    Bun.env.KIMI_PRE_PUSH_SERIAL = "1";
    expect(prePushRunsInParallel()).toBe(false);
    if (previous === undefined) delete Bun.env.KIMI_PRE_PUSH_SERIAL;
    else Bun.env.KIMI_PRE_PUSH_SERIAL = previous;
  });

  it("detectSyncDrift is clean for minimal toolchain stub (no managed sources)", async () => {
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

  it("should skip when golden is missing", async () => {
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
