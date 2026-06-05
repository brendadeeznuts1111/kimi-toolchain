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

function buildSteps(fast: boolean, timeoutMs: number): Step[] {
  return [
    { name: "format:check", cmd: ["bun", "run", "format:check"] },
    { name: "lint", cmd: ["bun", "run", "lint"] },
    { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
    {
      name: fast ? "test:fast" : "test",
      cmd: ["bun", ...bunTestArgs({ fast, timeoutMs, bail: true })],
    },
  ];
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
  const steps = buildSteps(fast, timeoutMs);

  if (dryRun) {
    console.log(`check ${fast ? "(fast) " : ""}— dry run`);
    console.log(`  test timeout: ${timeoutMs}ms`);
    for (const step of steps) {
      console.log(`  → ${step.cmd.join(" ")}`);
    }
    return;
  }

  for (const step of steps) {
    const code = await runStep(step);
    if (code !== 0) process.exit(code);
  }
}

main().catch((err) => {
  console.error("check failed:", err.message);
  process.exit(1);
});
