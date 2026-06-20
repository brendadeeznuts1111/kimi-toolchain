/**
 * effect-benchmark-card.ts — Dashboard card payload for the toolchain benchmark harness.
 *
 * Groups metrics by family, resolves threshold layer provenance, and builds health
 * snapshots without re-running benchmarks on every /api/health poll.
 */

import type { Metric } from "../harness/html-reporter.ts";
import type { PerfGateResult, TrainResult } from "./effect-benchmark.ts";
import {
  detectBenchmarkRegressions,
  readBenchmarkSnapshots,
} from "./effect-benchmark.ts";
import { thresholdsBaselinePath, thresholdsLegacyPath, thresholdsLocalPath } from "./paths.ts";

export type ThresholdSourceKind = "baseline" | "local" | "legacy" | "default";

export interface BenchmarkCardRow {
  name: string;
  symbol: string;
  operation: string;
  actualMs: number;
  thresholdMs: number;
  pass: boolean;
  skipped?: boolean;
  skipReason?: string;
  thresholdSource: ThresholdSourceKind;
}

export interface BenchmarkSnapshotSummary {
  count: number;
  lastRunAt?: string;
  regressions: number;
}

export interface EffectBenchmarkCardPayload {
  generatedAt: string;
  allPass: boolean;
  registrySize: number;
  measured: number;
  skipped: number;
  failures: string[];
  families: Record<string, BenchmarkCardRow[]>;
  metrics: BenchmarkCardRow[];
  thresholdLayers: string[];
  snapshot: BenchmarkSnapshotSummary;
  philosophy: string;
  train?: TrainResult;
}

export interface BenchmarkHealthCheck {
  status: "ok" | "warn" | "error" | "unknown";
  pass: boolean | null;
  measured: number;
  skipped: number;
  failures: number;
  lastRunAt?: string;
  message?: string;
}

export interface BuildEffectBenchmarkCardOptions {
  generatedAt?: string;
  thresholdSources?: Record<string, string>;
  train?: TrainResult;
  regressions?: number;
  snapshotCount?: number;
  lastRunAt?: string;
}

const FAMILY_ORDER = ["crypto", "httpClient", "util", "image", "clock", "uuid"];

const CARD_PHILOSOPHY =
  "src/harness/effect-handlers.ts → registerEffectBenchmark() → layered thresholds (baseline → local → legacy) → gate → .kimi/var/effect-benchmark.ndjson.";

/** Host-specific benchmarks train into the local overlay only. */
export function benchmarkFamily(registryKey: string): string {
  return registryKey.includes(".") ? registryKey.split(".")[0]! : registryKey;
}

export function thresholdSourceKind(
  registryKey: string,
  thresholdSources: Record<string, string>,
  projectRoot: string
): ThresholdSourceKind {
  const path = thresholdSources[registryKey];
  if (!path) return "default";
  if (path === thresholdsBaselinePath(projectRoot)) return "baseline";
  if (path === thresholdsLocalPath(projectRoot)) return "local";
  if (path === thresholdsLegacyPath(projectRoot)) return "legacy";
  return "legacy";
}

export function metricToCardRow(
  metric: Metric,
  thresholdSources: Record<string, string>,
  projectRoot: string
): BenchmarkCardRow {
  const name = metric.registryKey ?? metric.operation;
  return {
    name,
    symbol: metric.symbol,
    operation: metric.operation,
    actualMs: metric.actualMs,
    thresholdMs: metric.thresholdMs,
    pass: metric.pass,
    skipped: metric.skipped,
    skipReason: metric.skipReason,
    thresholdSource: thresholdSourceKind(name, thresholdSources, projectRoot),
  };
}

export function groupMetricsByFamily(rows: BenchmarkCardRow[]): Record<string, BenchmarkCardRow[]> {
  const families: Record<string, BenchmarkCardRow[]> = {};
  for (const row of rows) {
    const family = benchmarkFamily(row.name);
    (families[family] ??= []).push(row);
  }
  return families;
}

/** Stable family ordering for dashboard tables (crypto before httpClient, etc.). */
export function sortedFamilyKeys(families: Record<string, BenchmarkCardRow[]>): string[] {
  const keys = Object.keys(families);
  return keys.sort((a, b) => {
    const ai = FAMILY_ORDER.indexOf(a);
    const bi = FAMILY_ORDER.indexOf(b);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return a.localeCompare(b);
  });
}

export function buildEffectBenchmarkCardPayload(
  metrics: Metric[],
  gate: PerfGateResult,
  projectRoot: string,
  options: BuildEffectBenchmarkCardOptions = {}
): EffectBenchmarkCardPayload {
  const thresholdSources = options.thresholdSources ?? {};
  const rows = metrics.map((m) => metricToCardRow(m, thresholdSources, projectRoot));

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    allPass: gate.pass,
    registrySize: metrics.length,
    measured: metrics.filter((m) => !m.skipped).length,
    skipped: metrics.filter((m) => m.skipped).length,
    failures: gate.failures,
    families: groupMetricsByFamily(rows),
    metrics: rows,
    thresholdLayers: [
      "thresholds.baseline.json",
      ".kimi/thresholds.local.json",
      "thresholds.json (legacy)",
    ],
    snapshot: {
      count: options.snapshotCount ?? 0,
      lastRunAt: options.lastRunAt,
      regressions: options.regressions ?? 0,
    },
    philosophy: CARD_PHILOSOPHY,
    train: options.train,
  };
}

/** Lightweight health from the latest NDJSON snapshot (no benchmark run). */
export async function readBenchmarkHealthCheck(
  projectRoot: string
): Promise<BenchmarkHealthCheck> {
  const snapshots = await readBenchmarkSnapshots(projectRoot, 1);
  if (snapshots.length === 0) {
    return {
      status: "unknown",
      pass: null,
      measured: 0,
      skipped: 0,
      failures: 0,
      message: "No benchmark snapshots yet — use Refresh on the Effect Benchmarks card",
    };
  }

  const snap = snapshots[0]!;
  const measuredRows = snap.metrics.filter((m) => !m.skipped);
  const skipped = snap.metrics.length - measuredRows.length;
  const failureCount = measuredRows.filter((m) => !m.pass).length;
  const pass = failureCount === 0;

  return {
    status: pass ? "ok" : "error",
    pass,
    measured: measuredRows.length,
    skipped,
    failures: failureCount,
    lastRunAt: snap.generatedAt,
  };
}

export async function regressionsAgainstLatestSnapshot(
  projectRoot: string,
  metrics: Metric[]
): Promise<number> {
  const previous = (await readBenchmarkSnapshots(projectRoot, 1))[0];
  if (!previous) return 0;
  return detectBenchmarkRegressions(metrics, previous.metrics).length;
}