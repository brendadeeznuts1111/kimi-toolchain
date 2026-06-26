import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists, removePath } from "../src/lib/bun-io.ts";
import { buildSteps } from "../src/lib/check-pipeline.ts";
import type { CheckOptions } from "../src/lib/check-changed.ts";
import { testTempDir } from "./helpers.ts";

const REPO_ROOT = import.meta.dir + "/..";

const baseOptions: CheckOptions = {
  dryRun: false,
  fast: true,
  staged: false,
  verbose: false,
  timeoutMs: 1500,
  changedOnly: false,
  base: "main",
  baseExplicit: false,
  failFast: false,
  jsonSummary: false,
  skipTests: false,
  watch: false,
  watchTests: false,
  cacheResults: false,
  noCache: false,
};

describe("check-pipeline", () => {
  test("fast toolchain checks include references lint step", async () => {
    const steps = await buildSteps(REPO_ROOT, baseOptions, null);
    const referencesLint = steps.find((step) => step.name === "references:lint");
    expect(referencesLint?.cmd).toEqual(["bun", "run", "references:lint"]);
  });

  test("fast toolchain checks include env-drift step", async () => {
    const steps = await buildSteps(REPO_ROOT, baseOptions, null);
    const envDrift = steps.find((step) => step.name === "check:env-drift");
    expect(envDrift?.cmd).toEqual(["bun", "run", "scripts/check-env-drift.ts"]);
  });

  test("fast toolchain checks include release-ssot with blog audit skipped", async () => {
    const steps = await buildSteps(REPO_ROOT, baseOptions, null);
    const releaseSsot = steps.find((step) => step.name === "validate:release-ssot");
    expect(releaseSsot?.cmd).toEqual([
      "bun",
      "run",
      "scripts/validate-release-ssot.ts",
      "--skip-blog-audit",
    ]);
  });

  test("full check runs release-ssot with live blog audit", async () => {
    const steps = await buildSteps(REPO_ROOT, { ...baseOptions, fast: false }, null);
    const releaseSsot = steps.find((step) => step.name === "validate:release-ssot");
    expect(releaseSsot?.cmd).toEqual(["bun", "run", "scripts/validate-release-ssot.ts"]);
  });

  test("full check skips workspace verification in CI", async () => {
    const previous = Bun.env.KIMI_CI_LOCAL;
    try {
      Bun.env.KIMI_CI_LOCAL = "true";
      const steps = await buildSteps(REPO_ROOT, { ...baseOptions, fast: false }, null);
      expect(steps.find((step) => step.name === "verify-workspace")).toBeUndefined();
      expect(steps.find((step) => step.name === "format:check")).toBeDefined();
    } finally {
      if (previous === undefined) delete Bun.env.KIMI_CI_LOCAL;
      else Bun.env.KIMI_CI_LOCAL = previous;
    }
  });

  test("check --dry-run does not create a test gate lock", async () => {
    const root = testTempDir("check-dry-run-lock-");
    const lockDir = join(root, "locks");
    const previous = Bun.env.KIMI_TEST_LOCK_DIR;

    try {
      Bun.env.KIMI_TEST_LOCK_DIR = lockDir;
      const proc = Bun.spawn(["bun", "run", "scripts/check.ts", "--dry-run"], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await Bun.readableStreamToText(proc.stdout);
      const stderr = await Bun.readableStreamToText(proc.stderr);
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(stdout).toContain("format:check");
      expect(stdout).toContain("typecheck");
      expect(stdout).toContain("test:");
      expect(stdout + stderr).not.toContain("another Bun test gate is already running");
      expect(pathExists(lockDir)).toBe(false);
    } finally {
      if (previous === undefined) delete Bun.env.KIMI_TEST_LOCK_DIR;
      else Bun.env.KIMI_TEST_LOCK_DIR = previous;
      removePath(root, { recursive: true, force: true });
    }
  }, 10_000);
});
