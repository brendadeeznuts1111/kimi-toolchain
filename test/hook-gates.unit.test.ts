import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runConstantDriftGate } from "../src/lib/hook-gates.ts";
import { writeConstantsGolden } from "../src/lib/constants-heal.ts";

describe("hook-gates constant drift", () => {
  let projectDir: string;
  let previousSkip: string | undefined;

  beforeEach(() => {
    previousSkip = Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    delete Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    projectDir = join(tmpdir(), `hook-gates-drift-${Date.now()}`);
    mkdirSync(join(projectDir, ".git"), { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "kimi-toolchain", scripts: {} })
    );
  });

  afterEach(() => {
    if (previousSkip === undefined) delete Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE;
    else Bun.env.KIMI_SKIP_CONSTANT_DRIFT_GATE = previousSkip;
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("should skip gate for non-toolchain repos", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "other-project", scripts: {} })
    );
    const result = await runConstantDriftGate(projectDir);
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("should fail when bunfig drifts from golden", async () => {
    writeFileSync(
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
    writeFileSync(
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
    writeFileSync(
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

  it("should skip when golden is missing", async () => {
    writeFileSync(
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
