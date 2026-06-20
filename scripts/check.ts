#!/usr/bin/env bun
/**
 * Quality gate runner with --dry-run and --skip-tests support.
 *
 * Usage:
 *   bun run scripts/check.ts
 *   bun run scripts/check.ts --dry-run
 *   bun run scripts/check.ts --fast
 *   bun run scripts/check.ts --fast --skip-tests
 */

import { join } from "path";
import { isKimiToolchainRepo } from "../src/lib/workspace-health.ts";

const REPO_ROOT = join(import.meta.dir, "..");

interface Step {
  name: string;
  cmd: string[];
  silentOnSuccess?: boolean;
}

function parseCli(): { dryRun: boolean; fast: boolean; skipTests: boolean } {
  const argv = Bun.argv.slice(2);
  let dryRun = false;
  let fast = false;
  let skipTests = false;

  for (const arg of argv) {
    if (arg === "--dry-run" || arg === "--dryrun") dryRun = true;
    if (arg === "--fast") fast = true;
    if (arg === "--skip-tests") skipTests = true;
  }

  return { dryRun, fast, skipTests };
}

async function buildSteps(fast: boolean, skipTests: boolean): Promise<Step[]> {
  const steps: Step[] = [];
  if (!fast && (await isKimiToolchainRepo(REPO_ROOT))) {
    steps.push({
      name: "verify-workspace",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "workspace", "verify"],
    });
  }
  steps.push(
    {
      name: "success-metrics",
      cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "--success-metrics", "--json"],
      silentOnSuccess: true,
    },
    { name: "format:check", cmd: ["bun", "run", "format:check"] },
    { name: "lint", cmd: ["bun", "run", "lint"] },
    { name: "typecheck", cmd: ["bun", "run", "typecheck"] },
    {
      name: fast ? "test:fast" : "test",
      cmd: ["bun", "run", fast ? "test:fast" : "test"],
    }
  );
  return skipTests ? steps.filter((s) => s.name !== "test" && s.name !== "test:fast") : steps;
}

async function runStep(step: Step): Promise<number> {
  if (step.silentOnSuccess) {
    const proc = Bun.spawn(step.cmd, {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      Bun.readableStreamToText(proc.stdout),
      Bun.readableStreamToText(proc.stderr),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
    }
    return exitCode;
  }

  const proc = Bun.spawn(step.cmd, {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main() {
  const { dryRun, fast, skipTests } = parseCli();
  const steps = await buildSteps(fast, skipTests);

  if (dryRun) {
    console.log(`check ${fast ? "(fast) " : ""}${skipTests ? "(skip tests) " : ""}— dry run`);
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
