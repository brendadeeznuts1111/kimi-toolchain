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

async function runEffectBenchmarkCard(
  options: RunOptions = {}
): Promise<EffectBenchmarkCardPayload> {
  const projectRoot = resolveRoot();
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

  if (options.appendSnapshot) {
    regressions = await regressionsAgainstLatestSnapshot(projectRoot, metrics);
    const snapshot = await appendBenchmarkSnapshot(projectRoot, metrics);
    lastRunAt = snapshot.generatedAt;
  }

  const snapshots = await readBenchmarkSnapshots(projectRoot, KIMI_EFFECT_BENCHMARK_SNAPSHOT_MAX_RUNS);

  return buildEffectBenchmarkCardPayload(metrics, gate, projectRoot, {
    thresholdSources: sources,
    train,
    regressions,
    snapshotCount: snapshots.length,
    lastRunAt: options.appendSnapshot ? lastRunAt : snapshots[0]?.generatedAt,
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