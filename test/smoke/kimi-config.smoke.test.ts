import { makeDir, removePath } from "../../src/lib/bun-io.ts";

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { invokeTool } from "../../src/lib/tool-runner.ts";

import { REPO_ROOT, testTempDir } from "../helpers.ts";
const KIMI_CONFIG = join(REPO_ROOT, "src/bin/kimi-config.ts");

const BUNFIG = `[define]
# define-domain:hook-verifier
KIMI_HOOK_VERIFIER_MAX_CYCLES = "32"
# define-domain:governance
KIMI_TUNING_SET_VERSION = '"1.1.0"'
`;

const TYPES = `/**
 * @defineDomain hook-verifier
 * @type number
 * @default 32
 * @restrictions positive integer — max allowed hook-graph cycle length
 */
declare const KIMI_HOOK_VERIFIER_MAX_CYCLES: number;

/**
 * @defineDomain governance
 * @type string
 * @default "1.1.0"
 * @restrictions semver — bump when any other KIMI_* define is added, changed, or removed
 */
declare const KIMI_TUNING_SET_VERSION: string;
`;

async function run(projectRoot: string, args: string[]) {
  const result = await invokeTool(KIMI_CONFIG, args, {
    cwd: projectRoot,
    timeoutMs: 15_000,
  });
  return {
    stdout: result.stdout + result.stderr,
    exitCode: result.exitCode,
  };
}

describe("kimi-config smoke", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = testTempDir("kimi-config-smoke-");
    makeDir(join(projectRoot, "types"), { recursive: true });
    makeDir(join(projectRoot, ".kimi", "var"), { recursive: true });
    await Bun.write(join(projectRoot, ".kimi", "decisions.ndjson"), "");
    await Bun.write(join(projectRoot, "bunfig.toml"), BUNFIG);
    await Bun.write(join(projectRoot, "types", "build-constants.d.ts"), TYPES);
  });

  afterEach(() => {
    removePath(projectRoot, { recursive: true, force: true });
  });

  test("validate --json emits stable report", async () => {
    const { stdout, exitCode } = await run(projectRoot, ["validate", "--json"]);
    const report = JSON.parse(stdout) as { schemaVersion: number; summary: { ok: boolean } };
    expect(report.schemaVersion).toBe(1);
    expect(report.summary.ok).toBe(true);
    expect(exitCode).toBe(0);
  });

  test("canary, ab, timeline, and watch produce JSON", async () => {
    const canary = await run(projectRoot, [
      "canary",
      "--constant",
      "KIMI_HOOK_VERIFIER_MAX_CYCLES",
      "--value",
      "64",
      "--percent",
      "10",
      "--json",
    ]);
    const canaryReport = JSON.parse(canary.stdout) as {
      schemaVersion: number;
      record: { id: string; status: string };
    };
    expect(canaryReport.schemaVersion).toBe(1);
    expect(canaryReport.record.status).toBe("passed");
    expect(canary.exitCode).toBe(0);

    const ab = await run(projectRoot, [
      "ab",
      "--constant",
      "KIMI_HOOK_VERIFIER_MAX_CYCLES",
      "--a",
      "32",
      "--b",
      "64",
      "--duration",
      "1h",
      "--json",
    ]);
    expect(JSON.parse(ab.stdout).schemaVersion).toBe(1);
    expect(ab.exitCode).toBe(0);

    const timeline = await run(projectRoot, [
      "timeline",
      "--constant",
      "KIMI_HOOK_VERIFIER_MAX_CYCLES",
      "--json",
    ]);
    expect(JSON.parse(timeline.stdout).events.length).toBeGreaterThan(0);
    expect(timeline.exitCode).toBe(0);

    const watch = await run(projectRoot, ["watch", "--auto-rollback", "--dry-run", "--json"]);
    const watchReport = JSON.parse(watch.stdout) as { schemaVersion: number; status: string };
    expect(watchReport.schemaVersion).toBe(1);
    expect(watchReport.status).toBe("insufficient-data");
    expect(watch.exitCode).toBe(1);
  });
});
