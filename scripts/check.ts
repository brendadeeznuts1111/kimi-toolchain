#!/usr/bin/env bun
/**
 * Quality gate runner with --dry-run and --timeout support.
 *
 * Usage:
 *   bun run scripts/check.ts
 *   bun run scripts/check.ts --dry-run
 *   bun run scripts/check.ts --fast --timeout 100
 *   bun run scripts/check.ts --dryrun --fast
 *
 * @see https://bun.com/docs/guides/test/timeout
 */

import { join } from "path";
import {
  bunTestArgs,
  FAST_TEST_TIMEOUT_MS,
  DEFAULT_TEST_TIMEOUT_MS,
} from "../src/lib/test-gates.ts";
import { isKimiToolchainRepo } from "../src/lib/workspace-health.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface Step {
  name: string;
  cmd: string[];
}

function parseCli(): { dryRun: boolean; fast: boolean; timeoutMs: number } {
  const argv = Bun.argv.slice(2);
  let dryRun = false;
  let fast = false;
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
    if (arg === "--timeout") {
      const next = argv[++i];
      if (next) timeoutMs = parseInt(next, 10);
      continue;
    }
    if (arg.startsWith("--timeout=")) {
      timeoutMs = parseInt(arg.split("=")[1] ?? "", 10);
    }
  }

  if (fast && timeoutMs === DEFAULT_TEST_TIMEOUT_MS) {
    timeoutMs = FAST_TEST_TIMEOUT_MS;
  }

  return { dryRun, fast, timeoutMs };
}

async function buildSteps(fast: boolean, timeoutMs: number): Promise<Step[]> {
  const steps: Step[] = [];
  // Full check only — check:fast skips env blockers (cursor slug, wrappers) for quick iteration
  if (!fast && (await isKimiToolchainRepo(REPO_ROOT))) {
    steps.push({
      name: "verify-workspace",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"],
    });
  }
  steps.push(
    { name: "format:check", cmd: ["bun", "run", "format:check"] },
    { name: "lint", cmd: ["bun", "run", "lint"] },
    { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
    {
      name: fast ? "test:fast" : "test",
      cmd: ["bun", ...bunTestArgs({ fast, timeoutMs, bail: true })],
    }
  );
  return steps;
}

async function runStep(step: Step): Promise<number> {
  const proc = Bun.spawn(step.cmd, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main() {
  const { dryRun, fast, timeoutMs } = parseCli();
  const steps = await buildSteps(fast, timeoutMs);

  if (dryRun) {
    console.log(`check ${fast ? "(fast) " : ""}— dry run`);
    console.log(`  test timeout: ${timeoutMs}ms`);
    for (const step of steps) {
      console.log(`  → ${step.cmd.join(" ")}`);
    }
    return;
  }

  // Run independent gates (format, lint, typecheck) in parallel, then test
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
