import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists, removePath } from "../src/lib/bun-io.ts";
import { buildSteps } from "../src/lib/check-pipeline.ts";
import type { CheckOptions } from "../src/lib/check-types.ts";
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
  test("fast toolchain checks include canonical references drift check", async () => {
    const steps = await buildSteps(REPO_ROOT, baseOptions, null);
    const canonical = steps.find((step) => step.name === "canonical-references");
    expect(canonical?.cmd).toEqual([
      "bun",
      "run",
      "scripts/generate-canonical-references.ts",
      "--check",
    ]);
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
