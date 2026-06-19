#!/usr/bin/env bun
/**
 * perf-auto-train.ts — Closed-loop auto-training for effect benchmarks.
 *
 * Runs the registered effect-handler benchmarks, evaluates the gate, and
 * updates thresholds.json when everything passes. If thresholds changed,
 * it commits them so CI can close the training loop without a manual step.
 *
 * Usage:
 *   bun run scripts/perf-auto-train.ts
 *   bun run scripts/perf-auto-train.ts --push
 *   bun run perf:auto-train
 */

import { join } from "path";
import {
  appendBenchmarkSnapshot,
  detectBenchmarkRegressions,
  evaluateEffectBenchmarkGate,
  generateBenchmarkHTML,
  readBenchmarkSnapshots,
  trainEffectThresholds,
  type BenchmarkRegression,
} from "../src/lib/effect-benchmark.ts";
// Side-effect import: registers the built-in effect-handler benchmarks.
import { runEffectBenchmarks } from "../src/harness/perf-monitor.ts";
import type { Metric } from "../src/harness/html-reporter.ts";
import { invokeCommand } from "../src/lib/tool-runner.ts";

const REPO_ROOT = process.cwd();
const OUT_DIR = join(REPO_ROOT, "reports");
const THRESHOLDS_PATH = join(REPO_ROOT, "thresholds.json");
const REPORT_PATH = join(OUT_DIR, "effect-benchmark.html");

interface AutoTrainResult {
  ok: boolean;
  metrics: Metric[];
  gatePass: boolean;
  regressions: BenchmarkRegression[];
  trained: boolean;
  thresholdsPath: string;
  thresholdsChanged: boolean;
  committed: boolean;
  reportPath: string;
}

async function sha256File(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(await file.arrayBuffer());
    return hasher.digest("hex");
  } catch {
    return null;
  }
}

async function resolveGitHead(projectRoot: string): Promise<string | undefined> {
  try {
    const result = await invokeCommand(["git", "rev-parse", "HEAD"], {
      cwd: projectRoot,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function stageAndCommitThresholds(thresholdsPath: string): Promise<boolean> {
  const addResult = await invokeCommand(["git", "add", "--", thresholdsPath], {
    cwd: REPO_ROOT,
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
  });
  if (addResult.exitCode !== 0) {
    console.error("Failed to stage thresholds:", addResult.stderr);
    return false;
  }

  const commitResult = await invokeCommand(
    [
      "git",
      "commit",
      "--no-verify",
      "-m",
      "chore: auto-train effect benchmark thresholds",
      "--",
      thresholdsPath,
    ],
    {
      cwd: REPO_ROOT,
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    }
  );
  if (commitResult.exitCode !== 0) {
    console.error("Failed to commit thresholds:", commitResult.stderr);
    return false;
  }

  return true;
}

async function pushCommit(): Promise<boolean> {
  const result = await invokeCommand(["git", "push"], {
    cwd: REPO_ROOT,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
  });
  if (result.exitCode !== 0) {
    console.error("Failed to push thresholds:", result.stderr);
    return false;
  }
  return true;
}

export async function runPerfAutoTrain(options: { push?: boolean } = {}): Promise<AutoTrainResult> {
  const metrics = await runEffectBenchmarks({ thresholdsPath: THRESHOLDS_PATH });
  const gate = await evaluateEffectBenchmarkGate(metrics, THRESHOLDS_PATH);

  const previous = (await readBenchmarkSnapshots(REPO_ROOT, 1))[0];
  const regressions = previous ? detectBenchmarkRegressions(metrics, previous.metrics) : [];

  const result: AutoTrainResult = {
    ok: false,
    metrics,
    gatePass: gate.pass,
    regressions,
    trained: false,
    thresholdsPath: THRESHOLDS_PATH,
    thresholdsChanged: false,
    committed: false,
    reportPath: REPORT_PATH,
  };

  if (!gate.pass) {
    console.error("Performance gate failed — cannot auto-train:");
    for (const f of gate.failures) console.error(`  - ${f}`);
    return result;
  }

  if (regressions.length > 0) {
    console.error("Benchmark regressions detected — cannot auto-train:");
    for (const r of regressions) console.error(`  - ${r.message}`);
    return result;
  }

  const beforeHash = await sha256File(THRESHOLDS_PATH);
  const trainResult = await trainEffectThresholds(metrics, REPO_ROOT);
  result.trained = trainResult.written;

  if (!trainResult.written) {
    console.error("Training produced no thresholds — check registered handlers.");
    return result;
  }

  const afterHash = await sha256File(THRESHOLDS_PATH);
  result.thresholdsChanged = beforeHash !== afterHash;

  // Generate the living HTML report and snapshot history
  const gitHead = await resolveGitHead(REPO_ROOT);
  const snapshot = await appendBenchmarkSnapshot(REPO_ROOT, metrics, { gitHead });
  const history = await readBenchmarkSnapshots(REPO_ROOT, 10);
  const html = generateBenchmarkHTML(metrics, {
    title: "Effect Handler Benchmarks",
    meta: {
      generatedAt: snapshot.generatedAt,
      gitHead,
      regressionCount: regressions.length,
      snapshotCount: history.length,
    },
  });
  await Bun.write(REPORT_PATH, html);

  if (result.thresholdsChanged) {
    result.committed = await stageAndCommitThresholds(THRESHOLDS_PATH);
    if (result.committed && options.push) {
      await pushCommit();
    }
  }

  result.ok = true;
  return result;
}

async function main(): Promise<number> {
  const push = Bun.argv.includes("--push");
  const dryRun = Bun.argv.includes("--dry-run");

  if (dryRun) {
    console.log("perf:auto-train dry run — would:");
    console.log("  1. run registered effect benchmarks");
    console.log("  2. evaluate gate and regression checks");
    console.log("  3. write thresholds.json and reports/effect-benchmark.html");
    console.log(`  4. commit thresholds.json${push ? " and push" : ""} if changed`);
    return 0;
  }

  const result = await runPerfAutoTrain({ push });

  console.log(`Benchmarks:    ${result.metrics.length}`);
  console.log(`Gate:          ${result.gatePass ? "PASS" : "FAIL"}`);
  console.log(`Regressions:   ${result.regressions.length}`);
  console.log(`Trained:       ${result.trained}`);
  console.log(`Thresholds:    ${result.thresholdsPath}`);
  console.log(`Changed:       ${result.thresholdsChanged}`);
  console.log(`Committed:     ${result.committed}`);
  console.log(`Report:        ${result.reportPath}`);

  return result.ok ? 0 : 1;
}

if (import.meta.main) {
  process.exit(await main());
}
