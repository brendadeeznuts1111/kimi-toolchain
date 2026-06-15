#!/usr/bin/env bun
/**
 * Local Bun CI — mirrors .github/workflows/ci.yml quality + governance jobs.
 *
 * Usage:
 *   bun run ci:local
 *   bun run ci:local --job quality
 *   bun run ci:local --job governance
 *   bun run ci:local --dry-run
 *   bun run ci:local --json
 */

import { join } from "path";
import { emitGateFailure, runGate, type GateResult } from "../src/lib/gate-runner.ts";

const REPO_ROOT = join(import.meta.dir, "..");

type JobName = "quality" | "governance" | "all";

interface CiStep {
  job: Exclude<JobName, "all">;
  name: string;
  cmd: string[];
}

const STEPS: CiStep[] = [
  { job: "quality", name: "format:check:ci", cmd: ["bun", "run", "format:check:ci"] },
  { job: "quality", name: "lint", cmd: ["bun", "run", "lint"] },
  { job: "quality", name: "typecheck", cmd: ["bun", "run", "typecheck"] },
  { job: "quality", name: "test:coverage:ci", cmd: ["bun", "run", "test:coverage:ci"] },
  { job: "quality", name: "test:smoke", cmd: ["bun", "run", "test:smoke"] },
  {
    job: "governance",
    name: "governance-r-score",
    cmd: ["bun", "run", "governance", "score", "--min", "60"],
  },
];

function parseCli(): { job: JobName; dryRun: boolean; json: boolean } {
  const argv = Bun.argv.slice(2);
  let job: JobName = "all";
  let dryRun = false;
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--dryrun") {
      dryRun = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--job") {
      const next = argv[++i];
      if (next === "quality" || next === "governance" || next === "all") job = next;
      continue;
    }
    if (arg.startsWith("--job=")) {
      const value = arg.split("=")[1];
      if (value === "quality" || value === "governance" || value === "all") job = value;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
  }

  return { job, dryRun, json };
}

function selectedSteps(job: JobName): CiStep[] {
  if (job === "all") return STEPS;
  return STEPS.filter((step) => step.job === job);
}

async function runSteps(steps: CiStep[]): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const step of steps) {
    const result = await runGate(step.name, step.cmd, { cwd: REPO_ROOT });
    results.push(result);
    if (result.exitCode !== 0) break;
  }
  return results;
}

async function main(): Promise<number> {
  const { job, dryRun, json } = parseCli();
  const steps = selectedSteps(job);

  if (dryRun) {
    const payload = {
      mergeGate: "local-ci",
      job,
      steps: steps.map((step) => ({ job: step.job, name: step.name, cmd: step.cmd.join(" ") })),
    };
    if (json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      console.log(`ci:local (${job}) — dry run`);
      for (const step of steps) {
        console.log(`  [${step.job}] → ${step.cmd.join(" ")}`);
      }
    }
    return 0;
  }

  const results = await runSteps(steps);
  const failed = results.find((result) => result.exitCode !== 0);
  const ok = !failed;

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          mergeGate: "local-ci",
          job,
          ok,
          results: results.map((result) => ({
            name: result.name,
            exitCode: result.exitCode,
            ms: result.ms,
          })),
        },
        null,
        2
      )}\n`
    );
  } else if (ok) {
    const totalMs = results.reduce((sum, result) => sum + result.ms, 0);
    console.log(`✓ ci:local (${job}) — ${results.length} steps (${totalMs}ms)`);
  } else if (failed) {
    emitGateFailure(failed);
  }

  return ok ? 0 : 1;
}

main().catch((err: Error) => {
  console.error("ci:local failed:", err.message);
  process.exit(1);
});
