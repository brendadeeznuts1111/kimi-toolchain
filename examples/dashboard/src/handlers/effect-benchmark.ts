// ── Effect Handler Benchmark (toolchain registry) ───────────────────

import { runEffectBenchmarks } from "../../../../src/harness/perf-monitor.ts";
import {
  appendBenchmarkSnapshot,
  evaluateEffectBenchmarkGate,
  loadMergedEffectBenchmarkThresholds,
  readBenchmarkSnapshots,
  trainEffectThresholds,
} from "../../../../src/lib/effect-benchmark.ts";
import {
  buildEffectBenchmarkCardPayload,
  regressionsAgainstLatestSnapshot,
  type EffectBenchmarkCardPayload,
} from "../../../../src/lib/effect-benchmark-card.ts";
import { jsonResponse } from "./api-handlers.ts";
import { resolveRoot } from "./shared.ts";

interface RunOptions {
  appendSnapshot?: boolean;
  train?: boolean;
}

const HISTORY_LIMIT = 6;

async function runEffectBenchmarkCard(
  options: RunOptions = {}
): Promise<EffectBenchmarkCardPayload> {
  const projectRoot = resolveRoot();
  const historyBefore = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  const previousSnapshot = historyBefore[0];

  const { sources } = await loadMergedEffectBenchmarkThresholds(projectRoot);
  const metrics = await runEffectBenchmarks({ projectRoot });
  const gate = await evaluateEffectBenchmarkGate(metrics, undefined, projectRoot);

  let train;
  if (options.train && gate.pass) {
    train = await trainEffectThresholds(metrics, projectRoot);
  } else if (options.train) {
    train = { written: false, path: "", paths: [], thresholds: {} };
  }

  let regressions = 0;
  let lastRunAt = new Date().toISOString();
  let historyAfter = historyBefore;

  if (options.appendSnapshot) {
    regressions = await regressionsAgainstLatestSnapshot(projectRoot, metrics);
    const snapshot = await appendBenchmarkSnapshot(projectRoot, metrics);
    lastRunAt = snapshot.generatedAt;
    historyAfter = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  }

  const comparePrevious = options.appendSnapshot ? historyAfter[1] : previousSnapshot;

  return buildEffectBenchmarkCardPayload(metrics, gate, projectRoot, {
    thresholdSources: sources,
    train,
    regressions,
    snapshotCount: historyAfter.length,
    lastRunAt: options.appendSnapshot ? lastRunAt : historyAfter[0]?.generatedAt,
    historySnapshots: historyAfter,
    previousSnapshot: comparePrevious,
  });
}

export async function apiEffectBenchmark(): Promise<Response> {
  return jsonResponse(await runEffectBenchmarkCard());
}

export async function apiEffectBenchmarkRefresh(): Promise<Response> {
  return jsonResponse(await runEffectBenchmarkCard({ appendSnapshot: true }));
}

export async function apiEffectBenchmarkTrain(): Promise<Response> {
  return jsonResponse(
    await runEffectBenchmarkCard({ appendSnapshot: true, train: true })
  );
}