/**
 * Ported from oven-sh/bun test/cli/env/bun-options.test.ts @ pinned commit.
 *
 * Note: --cpu-prof and BUN_OPTIONS standalone-executable fixes shipped in Bun 1.3.7.
 * Tests requiring those features skip on older runtimes.
 */

import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { runBunOptionsContractProbes } from "../src/lib/bun-cli-contract-probes.ts";
import { withTempDir } from "./helpers.ts";

const BUN_AT_LEAST_1_3_7 = Bun.semver.satisfies(Bun.version, ">=1.3.7");

describe("bun-cli-bun-options contract probes", () => {
  test("runBunOptionsContractProbes all pass on current Bun", async () => {
    const results = await runBunOptionsContractProbes();
    // cpu-prof probes require Bun >= 1.3.7
    const required = results.filter(
      (r) =>
        !r.id.startsWith("cli.bun-options.cpu-prof") && !r.id.startsWith("cli.bun-options.compile")
    );
    const failed = required.filter((r) => !r.ok);
    expect(failed).toEqual([]);

    // Optional: cpu-prof + compile probes pass when Bun >= 1.3.7
    if (BUN_AT_LEAST_1_3_7) {
      const optFailed = results.filter(
        (r) =>
          (r.id.startsWith("cli.bun-options.cpu-prof") ||
            r.id.startsWith("cli.bun-options.compile")) &&
          !r.ok
      );
      expect(optFailed).toEqual([]);
    }
  });
});

describe("bun-cli-bun-options", () => {
  test("basic usage - passes options to bun command", () => {
    const proc = Bun.spawnSync({
      cmd: [process.execPath],
      env: { ...Bun.env, BUN_OPTIONS: "--print='BUN_OPTIONS WAS A SUCCESS'" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(0);
    expect(proc.stdout.toString()).toContain("BUN_OPTIONS WAS A SUCCESS");
  });

  test("bare flag before flag with value is recognized", async () => {
    if (!BUN_AT_LEAST_1_3_7) {
      console.warn("Skipping — --cpu-prof requires Bun >= 1.3.7, got", Bun.version);
      return;
    }
    await withTempDir("cpu-prof-", async (dir) => {
      const proc = Bun.spawnSync({
        cmd: [process.execPath, "-e", "1"],
        env: { ...Bun.env, BUN_OPTIONS: `--cpu-prof --cpu-prof-dir=${dir}` },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(0);
      const files = [...new Glob("*.cpuprofile").scanSync({ cwd: dir })];
      expect(files.length).toBeGreaterThanOrEqual(1);
    });
  });
});
