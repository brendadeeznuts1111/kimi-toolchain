#!/usr/bin/env bun
/**
 * Quality gate runner with --dry-run, --staged, and --timeout support.
 *
 * Usage:
 *   bun run scripts/check.ts
 *   bun run scripts/check.ts --dry-run
 *   bun run scripts/check.ts --staged
 *   bun run scripts/check.ts --fast --timeout 100
 *   bun run scripts/check.ts --dryrun --fast
 *   bun run scripts/check.ts --verbose
 *
 * Gates are silent on success by default. Use --verbose or set KIMI_VERBOSE=1
 * to stream full output. Failures are always verbose.
 *
 * @see https://bun.com/docs/guides/test/timeout
 */

import { join } from "path";
import {
  bunTestArgs,
  FAST_TEST_TIMEOUT_MS,
  DEFAULT_TEST_TIMEOUT_MS,
} from "../src/lib/test-gates.ts";
import { runCheckStep, shouldSilentOnSuccess } from "../src/lib/gate-runner.ts";
import { ensureQuietEnv } from "../src/lib/quiet-mode.ts";
import { isKimiToolchainRepo } from "../src/lib/workspace-health.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface Step {
  name: string;
  cmd: string[];
  silentOnSuccess?: boolean;
}

function parseTimeout(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid --timeout: ${raw ?? ""}`);
  }
  return value;
}

function parseCli(): {
  dryRun: boolean;
  fast: boolean;
  staged: boolean;
  verbose: boolean;
  timeoutMs: number;
} {
  const argv = Bun.argv.slice(2);
  let dryRun = false;
  let fast = false;
  let staged = false;
  let verbose = false;
  let timeoutMs = DEFAULT_TEST_TIMEOUT_MS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
      continue;
    }
    if (arg === "--fast") {
      fast = true;
      continue;
    }
    if (arg === "--staged") {
      staged = true;
      fast = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--timeout") {
      const next = argv[++i];
      timeoutMs = parseTimeout(next);
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutMs = parseTimeout(arg.split("=")[1]);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (fast && timeoutMs === DEFAULT_TEST_TIMEOUT_MS) {
    timeoutMs = FAST_TEST_TIMEOUT_MS;
  }

  return { dryRun, fast, staged, verbose, timeoutMs };
}

async function buildSteps(
  fast: boolean,
  staged: boolean,
  verbose: boolean,
  timeoutMs: number
): Promise<Step[]> {
  const quiet = !verbose && shouldSilentOnSuccess();
  const steps: Step[] = [];
  if (staged) {
    steps.push({
      name: "pre-commit",
      cmd: ["bun", "run", "src/bin/kimi-githooks.ts", "run-gates", "pre-commit"],
      silentOnSuccess: quiet,
    });
  }
  if (!fast && (await isKimiToolchainRepo(REPO_ROOT))) {
    steps.push({
      name: "verify-workspace",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"],
      silentOnSuccess: quiet,
    });
  }
  steps.push(
    {
      name: "success-metrics",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "--success-metrics", "--json"],
      silentOnSuccess: true,
    },
    {
      name: "format:check",
      cmd: ["bun", "run", "format:check"],
      silentOnSuccess: quiet,
    },
    {
      name: "lint",
      cmd: ["bun", "run", "lint"],
      silentOnSuccess: quiet,
    },
    {
      name: "typecheck",
      cmd: ["bun", "run", "typecheck"],
      silentOnSuccess: quiet,
    },
    {
      name: fast ? "test:fast" : "test",
      cmd: ["bun", ...bunTestArgs({ fast, timeoutMs, bail: true, retry: 2, dots: quiet })],
      // retry is applied here because Bun forbids [test] retry together with --rerun-each.
      silentOnSuccess: quiet,
    }
  );
  return steps;
}

async function runStep(step: Step): Promise<number> {
  if (step.silentOnSuccess) {
    return runCheckStep(step.name, step.cmd, REPO_ROOT);
  }
  const proc = Bun.spawn(step.cmd, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main() {
  ensureQuietEnv();
  const { dryRun, fast, staged, verbose, timeoutMs } = parseCli();
  const steps = await buildSteps(fast, staged, verbose, timeoutMs);

  if (dryRun) {
    const mode = staged ? "(staged fast) " : fast ? "(fast) " : "";
    const quiet = !verbose && shouldSilentOnSuccess() ? "(quiet) " : "";
    console.log(`check ${mode}${quiet}— dry run`);
    console.log(`  test timeout: ${timeoutMs}ms`);
    for (const step of steps) {
      console.log(`  → ${step.cmd.join(" ")}`);
    }
    return;
  }

  const testStep = steps.find((s) => s.name === "test" || s.name === "test:fast");
  const independentSteps = steps.filter((s) => s !== testStep);

  const independentResults = await Promise.all(independentSteps.map(runStep));
  const firstFail = independentResults.find((c) => c !== 0);
  if (firstFail !== undefined) process.exit(firstFail);

  if (testStep) {
    const testCode = await runStep(testStep);
    if (testCode !== 0) process.exit(testCode);
  }
}

main().catch((err) => {
  console.error("check failed:", err.message);
  process.exit(1);
});
