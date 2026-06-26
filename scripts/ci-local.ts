#!/usr/bin/env bun
/**
 * Local Bun CI — the canonical enforcement surface.
 * Server CI is disabled; this script + pre-push hooks enforce all gates.
 *
 * Usage:
 *   bun run ci:local
 *   bun run ci:local --job quality
 *   bun run ci:local --job governance
 *   bun run ci:local --dry-run
 *   bun run ci:local --json
 *
 * If coverage governance fails after interrupted test runs, clear stale temps:
 *   rm -f coverage/*.tmp
 */

import { join } from "path";
import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import { pathExists } from "../src/lib/bun-io.ts";
import { emitGateFailure, runGate, type GateResult } from "../src/lib/gate-runner.ts";

const REPO_ROOT = join(import.meta.dir, "..");

/** Remove stale Bun coverage temp files that break governance coverage reads. */
async function cleanCoverageTmp(): Promise<number> {
  const coverageDir = join(REPO_ROOT, "coverage");
  if (!pathExists(coverageDir)) return 0;
  let removed = 0;
  for (const file of new Bun.Glob("*.tmp").scanSync({ cwd: coverageDir, onlyFiles: true })) {
    await Bun.file(join(coverageDir, file)).delete();
    removed++;
  }
  return removed;
}

type JobName = "quality" | "governance" | "all";

interface CiStep {
  job: Exclude<JobName, "all">;
  name: string;
  cmd: string[];
  /** When true, this step always runs regardless of --job filter. */
  crossCut?: boolean;
}

const STEPS: CiStep[] = [
  { job: "quality", name: "format:check:ci", cmd: ["bun", "run", "format:check:ci"] },
  { job: "quality", name: "lint", cmd: ["bun", "run", "lint"] },
  { job: "quality", name: "typecheck", cmd: ["bun", "run", "typecheck"] },
  { job: "quality", name: "test:coverage:ci", cmd: ["bun", "run", "test:coverage:ci"] },
  { job: "quality", name: "test:smoke", cmd: ["bun", "run", "test:smoke"] },
  {
    job: "quality",
    name: "effect-gates",
    cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "--effect-gates"],
    crossCut: true,
  },
  {
    job: "quality",
    name: "effect-benchmark",
    cmd: ["bun", "run", "perf:effect-handlers"],
    crossCut: true,
  },
  {
    job: "quality",
    name: "effect-benchmark-auto-train",
    cmd: ["bun", "run", "perf:auto-train"],
    crossCut: true,
  },
  {
    job: "quality",
    name: "probe-cards",
    cmd: ["bun", "run", "src/bin/kimi-doctor.ts", "--probe-cards", "--strict-probe"],
    crossCut: true,
  },
  {
    job: "quality",
    name: "config-status",
    cmd: ["bun", "run", "config:status"],
  },
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
    if (!arg) continue;
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
  return STEPS.filter((step) => step.job === job || step.crossCut === true);
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
      writeStdoutJsonSync(payload, 2);
    } else {
      console.log(`ci:local (${job}) — dry run`);
      for (const step of steps) {
        console.log(`  [${step.job}] → ${step.cmd.join(" ")}`);
      }
    }
    return 0;
  }

  const staleCoverage = await cleanCoverageTmp();
  if (staleCoverage > 0 && !json) {
    console.log(`ci:local — removed ${staleCoverage} stale coverage/*.tmp file(s)`);
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
