/**
 * effect-benchmark-card.ts — Dashboard card payload for the toolchain benchmark harness.
 *
 * Groups metrics by family, resolves threshold layer provenance, attaches sparkline
 * history and per-row regression flags, and builds health snapshots without re-running
 * benchmarks on every /api/health poll.
 */

import type { Metric } from "../harness/html-reporter.ts";
import type { EffectBenchmarkSnapshot, PerfGateResult, TrainResult } from "./effect-benchmark.ts";
import {
  detectBenchmarkRegressions,
  readBenchmarkSnapshots,
} from "./effect-benchmark.ts";
import { thresholdsBaselinePath, thresholdsLegacyPath, thresholdsLocalPath } from "./paths.ts";

export type ThresholdSourceKind = "baseline" | "local" | "legacy" | "default";

export interface BenchmarkCardRegression {
  regressed: boolean;
  deltaMs: number;
  previousMs: number;
}

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
  regression?: BenchmarkCardRegression;
  sparkline?: number[];
}

export interface BenchmarkRecentRun {
  generatedAt: string;
  measured: number;
  passed: number;
  allPass: boolean;
}

export interface BenchmarkSnapshotSummary {
  count: number;
  lastRunAt?: string;
  regressions: number;
  regressionKeys: string[];
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
  recentRuns: BenchmarkRecentRun[];
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
  regressions?: number;
  regressionKeys?: string[];
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
  /** NDJSON history, newest first (up to 5–6 rows). */
  historySnapshots?: EffectBenchmarkSnapshot[];
  /** Snapshot to compare against for per-row regression (previous run). */
  previousSnapshot?: EffectBenchmarkSnapshot;
}

const FAMILY_ORDER = ["crypto", "httpClient", "util", "image", "clock", "uuid"];
const SPARKLINE_HISTORY_LIMIT = 5;
const RECENT_RUNS_LIMIT = 5;

const CARD_PHILOSOPHY =
  "src/harness/effect-handlers.ts → registerEffectBenchmark() → layered thresholds (baseline → local → legacy) → gate → .kimi/var/effect-benchmark.ndjson.";

function metricKey(metric: Metric): string {
  return metric.registryKey ?? metric.operation;
}

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

/** Last N actualMs per registry key from NDJSON, oldest → newest. */
export function buildSparklines(
  snapshots: EffectBenchmarkSnapshot[],
  registryKeys: string[],
  limit = SPARKLINE_HISTORY_LIMIT
): Record<string, number[]> {
  const chronologic = [...snapshots].slice(0, limit).reverse();
  const result: Record<string, number[]> = {};

  for (const key of registryKeys) {
    const series: number[] = [];
    for (const snap of chronologic) {
      const metric = snap.metrics.find((m) => metricKey(m) === key);
      if (metric && !metric.skipped && !Number.isNaN(metric.actualMs)) {
        series.push(metric.actualMs);
      }
    }
    if (series.length > 0) result[key] = series;
  }

  return result;
}

export function rowRegression(
  metric: Metric,
  previousMetrics: Metric[] | undefined
): BenchmarkCardRegression | undefined {
  if (!previousMetrics?.length || metric.skipped || Number.isNaN(metric.actualMs)) {
    return undefined;
  }

  const prev = previousMetrics.find((m) => metricKey(m) === metricKey(metric));
  if (!prev || prev.skipped || Number.isNaN(prev.actualMs)) return undefined;

  const hits = detectBenchmarkRegressions([metric], [prev]);
  if (hits.length === 0) return undefined;

  const hit = hits[0]!;
  return {
    regressed: true,
    deltaMs: Math.round((hit.currentMs - hit.previousMs) * 1000) / 1000,
    previousMs: hit.previousMs,
  };
}

export function buildRecentRunsSummary(
  snapshots: EffectBenchmarkSnapshot[],
  limit = RECENT_RUNS_LIMIT
): BenchmarkRecentRun[] {
  return snapshots.slice(0, limit).map((snap) => {
    const measured = snap.metrics.filter((m) => !m.skipped);
    const passed = measured.filter((m) => m.pass).length;
    return {
      generatedAt: snap.generatedAt,
      measured: measured.length,
      passed,
      allPass: measured.length > 0 && passed === measured.length,
    };
  });
}

export function enrichCardRows(
  metrics: Metric[],
  thresholdSources: Record<string, string>,
  projectRoot: string,
  options: {
    historySnapshots?: EffectBenchmarkSnapshot[];
    previousSnapshot?: EffectBenchmarkSnapshot;
  } = {}
): BenchmarkCardRow[] {
  const keys = metrics.map(metricKey);
  const sparklines = buildSparklines(options.historySnapshots ?? [], keys);
  const previousMetrics = options.previousSnapshot?.metrics;

  return metrics.map((metric) => {
    const name = metricKey(metric);
    const row: BenchmarkCardRow = {
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

    const regression = rowRegression(metric, previousMetrics);
    if (regression) row.regression = regression;

    const sparkline = sparklines[name];
    if (sparkline?.length) row.sparkline = sparkline;

    return row;
  });
}

export function metricToCardRow(
  metric: Metric,
  thresholdSources: Record<string, string>,
  projectRoot: string
): BenchmarkCardRow {
  return enrichCardRows([metric], thresholdSources, projectRoot)[0]!;
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
  const historySnapshots = options.historySnapshots ?? [];
  const rows = enrichCardRows(metrics, thresholdSources, projectRoot, {
    historySnapshots,
    previousSnapshot: options.previousSnapshot,
  });

  const regressionKeys = rows.filter((r) => r.regression?.regressed).map((r) => r.name);
  const regressions =
    options.regressions ?? regressionKeys.length;

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    allPass: gate.pass,
    registrySize: metrics.length,
    measured: metrics.filter((m) => !m.skipped).length,
    skipped: metrics.filter((m) => m.skipped).length,
    failures: gate.failures,
    families: groupMetricsByFamily(rows),
    metrics: rows,
    recentRuns: buildRecentRunsSummary(historySnapshots),
    thresholdLayers: [
      "thresholds.baseline.json",
      ".kimi/thresholds.local.json",
      "thresholds.json (legacy)",
    ],
    snapshot: {
      count: options.snapshotCount ?? historySnapshots.length,
      lastRunAt: options.lastRunAt ?? historySnapshots[0]?.generatedAt,
      regressions,
      regressionKeys,
    },
    philosophy: CARD_PHILOSOPHY,
    train: options.train,
  };
}

function regressionsBetweenSnapshots(
  current: EffectBenchmarkSnapshot,
  previous: EffectBenchmarkSnapshot
): ReturnType<typeof detectBenchmarkRegressions> {
  return detectBenchmarkRegressions(current.metrics, previous.metrics);
}

/** Lightweight health from the latest NDJSON snapshot (no benchmark run). */
export async function readBenchmarkHealthCheck(
  projectRoot: string
): Promise<BenchmarkHealthCheck> {
  const snapshots = await readBenchmarkSnapshots(projectRoot, 2);
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

  let regressions = 0;
  let regressionKeys: string[] = [];
  if (snapshots.length >= 2) {
    const hits = regressionsBetweenSnapshots(snap, snapshots[1]!);
    regressions = hits.length;
    regressionKeys = hits.map((h) => h.registryKey);
  }

  let status: BenchmarkHealthCheck["status"] = pass ? "ok" : "error";
  if (pass && regressions > 0) status = "warn";

  return {
    status,
    pass,
    measured: measuredRows.length,
    skipped,
    failures: failureCount,
    regressions,
    regressionKeys,
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