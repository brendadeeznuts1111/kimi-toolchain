/**
 * effect-benchmark-card.ts — Dashboard card payload for the toolchain benchmark harness.
 *
 * Groups metrics by family, resolves threshold layer provenance, attaches sparkline
 * history and per-row regression flags, and builds health snapshots without re-running
 * benchmarks on every /api/health poll.
 */

import type { Metric } from "../harness/html-reporter.ts";
import type {
  BenchmarkHandlerError,
  EffectBenchmarkSnapshot,
  PerfGateResult,
  TrainResult,
} from "./effect-benchmark.ts";
import {
  appendBenchmarkSnapshot,
  detectBenchmarkRegressions,
  evaluateEffectBenchmarkGate,
  loadMergedEffectBenchmarkThresholds,
  readBenchmarkSnapshots,
  runEffectBenchmarksReport,
  trainEffectThresholds,
} from "./effect-benchmark.ts";
import type { BenchmarkConvergenceBlock } from "./benchmark-convergence.ts";
import { buildBenchmarkConvergenceBlock } from "./benchmark-convergence.ts";
import { BUN_TEST_CHANGED_IMPORT_GRAPH } from "./test-runtime.ts";
import type { ConfigStatusReport } from "./config-status.ts";
import { thresholdsBaselinePath, thresholdsLegacyPath, thresholdsLocalPath } from "./paths.ts";

export const BENCHMARK_API_SCHEMA_VERSION = 1;
const HISTORY_LIMIT = 6;

export interface BenchmarkTaxonomyError {
  type: string;
  severity: "info" | "warn" | "error";
  details: string;
  registryKey?: string;
}

export interface BenchmarkSummary {
  total: number;
  passing: number;
  measured: number;
  skipped: number;
  partialSuccess: boolean;
  regressions: number;
  timedOut: boolean;
}

export interface BenchmarkGateInfo {
  status: "pass" | "warn" | "partial" | "fail";
  reason?: string;
}

export interface BenchmarkApiMetadata {
  trainApplied?: boolean;
  cacheHit?: boolean;
  timedOut?: boolean;
  /** Canvas + Dashboard + Herdr unification — stamped on every emission. */
  convergence?: BenchmarkConvergenceBlock;
  /** Bun `--changed` import-graph mechanics — portal + card-bun-test SSOT. */
  testExecution?: {
    changedImportGraph: typeof BUN_TEST_CHANGED_IMPORT_GRAPH;
  };
}

/** Shared envelope for dashboard API and kimi-doctor --perf-gates --json. */
export interface BenchmarkApiEnvelope extends EffectBenchmarkCardPayload {
  ok: boolean;
  schemaVersion: number;
  timestamp: string;
  runner: string;
  thresholdSource: string;
  summary: BenchmarkSummary;
  sparklines: Record<string, number[]>;
  taxonomyErrors?: BenchmarkTaxonomyError[];
  gates: { effectBenchmarkGate: BenchmarkGateInfo };
  metadata: BenchmarkApiMetadata;
  /** Read-only configuration alignment snapshot from serve-probe. */
  configStatus?: ConfigStatusReport;
  requestError?: string;
  lastSuccessfulAt?: string;
  retryAfterMs?: number;
}

export interface EffectBenchmarkCardLoopOptions {
  projectRoot: string;
  runner?: string;
  train?: boolean;
  appendSnapshot?: boolean;
  timeoutMs?: number;
  thresholdsPath?: string;
  gitHead?: string;
  mapTaxonomy?: boolean;
}

let lastGoodEnvelope: BenchmarkApiEnvelope | null = null;
let lastGoodAt: string | null = null;

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
  partialSuccess?: boolean;
  timedOut?: boolean;
  errors?: BenchmarkHandlerError[];
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
  partialSuccess?: boolean;
  timedOut?: boolean;
  errors?: BenchmarkHandlerError[];
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
  const regressions = options.regressions ?? regressionKeys.length;

  const payload: EffectBenchmarkCardPayload = {
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

  if (options.partialSuccess) payload.partialSuccess = true;
  if (options.timedOut) payload.timedOut = true;
  if (options.errors?.length) payload.errors = options.errors;

  return payload;
}

function regressionsBetweenSnapshots(
  current: EffectBenchmarkSnapshot,
  previous: EffectBenchmarkSnapshot
): ReturnType<typeof detectBenchmarkRegressions> {
  return detectBenchmarkRegressions(current.metrics, previous.metrics);
}

/** Lightweight health from the latest NDJSON snapshot (no benchmark run). */
export async function readBenchmarkHealthCheck(projectRoot: string): Promise<BenchmarkHealthCheck> {
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

export function resolveThresholdSourceLabel(
  thresholdSources: Record<string, string>,
  projectRoot: string
): string {
  const usesBaseline = Object.values(thresholdSources).some(
    (p) => p === thresholdsBaselinePath(projectRoot)
  );
  const usesLocal = Object.values(thresholdSources).some(
    (p) => p === thresholdsLocalPath(projectRoot)
  );
  const usesLegacy = Object.values(thresholdSources).some(
    (p) => p === thresholdsLegacyPath(projectRoot)
  );
  const parts: string[] = [];
  if (usesBaseline) parts.push("baseline");
  if (usesLocal) parts.push("local");
  if (usesLegacy) parts.push("legacy");
  return parts.length > 0 ? parts.join("+") : "default";
}

export function buildSparklineMap(rows: BenchmarkCardRow[]): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  for (const row of rows) {
    if (row.sparkline?.length) {
      map[row.name] = row.sparkline;
    } else if (!row.skipped && !Number.isNaN(row.actualMs)) {
      map[row.name] = [row.actualMs];
    }
  }
  return map;
}

export function mapBenchmarkTaxonomyErrors(
  payload: EffectBenchmarkCardPayload,
  handlerErrors: BenchmarkHandlerError[] = []
): BenchmarkTaxonomyError[] {
  const out: BenchmarkTaxonomyError[] = [];

  if (payload.timedOut) {
    out.push({
      type: "perf_gate_timeout",
      severity: "warn",
      details: "Benchmark run exceeded wall-clock timeout before all handlers completed",
    });
  }

  if (payload.partialSuccess) {
    out.push({
      type: "perf_gate_partial",
      severity: "warn",
      details: "Some handlers succeeded while others failed or were skipped due to timeout",
    });
  }

  for (const err of handlerErrors) {
    out.push({
      type: "perf_handler_failure",
      severity: "error",
      details: err.message,
      registryKey: err.registryKey,
    });
  }

  for (const failure of payload.failures) {
    out.push({
      type: "perf_gate_threshold",
      severity: "error",
      details: failure,
    });
  }

  return out;
}

function resolveGateStatus(
  payload: EffectBenchmarkCardPayload,
  gate: PerfGateResult
): BenchmarkGateInfo {
  if (payload.timedOut || payload.partialSuccess) {
    return {
      status: "partial",
      reason: gate.failures[0] ?? "partial benchmark run",
    };
  }
  if (!gate.pass) {
    return { status: "fail", reason: gate.failures[0] };
  }
  if (payload.snapshot.regressions > 0) {
    return {
      status: "warn",
      reason: `${payload.snapshot.regressions} regression(s) vs prior run`,
    };
  }
  return { status: "pass" };
}

export function buildBenchmarkApiEnvelope(
  payload: EffectBenchmarkCardPayload,
  context: {
    runner: string;
    thresholdSource: string;
    gate: PerfGateResult;
    ok?: boolean;
    mapTaxonomy?: boolean;
    requestError?: string;
    retryAfterMs?: number;
    lastSuccessfulAt?: string;
    cacheHit?: boolean;
    handlerErrors?: BenchmarkHandlerError[];
    trainApplied?: boolean;
  }
): BenchmarkApiEnvelope {
  const passing = payload.metrics.filter((m) => m.pass && !m.skipped).length;
  const gateInfo = resolveGateStatus(payload, context.gate);
  const taxonomyErrors = context.mapTaxonomy
    ? mapBenchmarkTaxonomyErrors(payload, context.handlerErrors ?? payload.errors)
    : undefined;

  return {
    ...payload,
    ok: context.ok ?? (context.requestError ? false : gateInfo.status !== "fail"),
    schemaVersion: BENCHMARK_API_SCHEMA_VERSION,
    timestamp: payload.generatedAt,
    runner: context.runner,
    thresholdSource: context.thresholdSource,
    summary: {
      total: payload.registrySize,
      passing,
      measured: payload.measured,
      skipped: payload.skipped,
      partialSuccess: payload.partialSuccess ?? false,
      regressions: payload.snapshot.regressions,
      timedOut: payload.timedOut ?? false,
    },
    sparklines: buildSparklineMap(payload.metrics),
    taxonomyErrors,
    gates: { effectBenchmarkGate: gateInfo },
    metadata: {
      trainApplied: context.trainApplied ?? payload.train?.written,
      cacheHit: context.cacheHit,
      timedOut: payload.timedOut,
      convergence: buildBenchmarkConvergenceBlock(context.runner),
      testExecution: { changedImportGraph: BUN_TEST_CHANGED_IMPORT_GRAPH },
    },
    requestError: context.requestError,
    lastSuccessfulAt: context.lastSuccessfulAt,
    retryAfterMs: context.retryAfterMs,
  };
}

/** Orchestration heart — shared by dashboard handler and kimi-doctor --perf-gates. */
export async function runEffectBenchmarkCardLoop(
  options: EffectBenchmarkCardLoopOptions
): Promise<BenchmarkApiEnvelope> {
  await import("../harness/perf-monitor.ts");
  const projectRoot = options.projectRoot;
  const historyBefore = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  const previousSnapshot = historyBefore[0];

  const { sources } = await loadMergedEffectBenchmarkThresholds(projectRoot);
  const report = await runEffectBenchmarksReport({
    projectRoot,
    thresholdsPath: options.thresholdsPath,
    timeoutMs: options.timeoutMs,
  });
  const { metrics, errors, timedOut, partialSuccess } = report;
  const gate = await evaluateEffectBenchmarkGate(metrics, options.thresholdsPath, projectRoot);

  let train: TrainResult | undefined;
  if (options.train && gate.pass && !timedOut) {
    const trainOutDir = options.thresholdsPath
      ? options.thresholdsPath.replace(/\/thresholds\.json$/, "")
      : projectRoot;
    train = await trainEffectThresholds(metrics, trainOutDir);
  } else if (options.train) {
    train = { written: false, path: "", paths: [], thresholds: {} };
  }

  let regressions = 0;
  let lastRunAt = new Date().toISOString();
  let historyAfter = historyBefore;

  if (options.appendSnapshot && metrics.length > 0) {
    regressions = await regressionsAgainstLatestSnapshot(projectRoot, metrics);
    const snapshot = await appendBenchmarkSnapshot(projectRoot, metrics, {
      gitHead: options.gitHead,
    });
    lastRunAt = snapshot.generatedAt;
    historyAfter = await readBenchmarkSnapshots(projectRoot, HISTORY_LIMIT);
  }

  const comparePrevious = options.appendSnapshot ? historyAfter[1] : previousSnapshot;

  const payload = buildEffectBenchmarkCardPayload(metrics, gate, projectRoot, {
    thresholdSources: sources,
    train,
    regressions,
    snapshotCount: historyAfter.length,
    lastRunAt: options.appendSnapshot ? lastRunAt : historyAfter[0]?.generatedAt,
    historySnapshots: historyAfter,
    previousSnapshot: comparePrevious,
    partialSuccess,
    timedOut,
    errors,
  });

  const envelope = buildBenchmarkApiEnvelope(payload, {
    runner: options.runner ?? "effect-benchmark",
    thresholdSource: resolveThresholdSourceLabel(sources, projectRoot),
    gate,
    mapTaxonomy: options.mapTaxonomy ?? true,
    handlerErrors: errors,
    trainApplied: train?.written,
  });

  rememberLastGoodEnvelope(envelope);
  return envelope;
}

export function rememberLastGoodEnvelope(envelope: BenchmarkApiEnvelope): void {
  if (envelope.registrySize > 0) {
    lastGoodEnvelope = envelope;
    lastGoodAt = envelope.timestamp;
  }
}

export function getLastGoodBenchmarkEnvelope(): BenchmarkApiEnvelope | null {
  return lastGoodEnvelope;
}

export function getLastGoodBenchmarkAt(): string | null {
  return lastGoodAt;
}

export function benchmarkErrorApiEnvelope(
  requestError: string,
  overrides?: { retryAfterMs?: number }
): BenchmarkApiEnvelope {
  if (lastGoodEnvelope) {
    return {
      ...lastGoodEnvelope,
      ok: false,
      requestError,
      retryAfterMs: overrides?.retryAfterMs,
      lastSuccessfulAt: lastGoodAt ?? lastGoodEnvelope.timestamp,
      metadata: { ...lastGoodEnvelope.metadata, cacheHit: true },
    };
  }

  const emptyGate: PerfGateResult = { pass: false, failures: [requestError] };
  const emptyPayload = buildEffectBenchmarkCardPayload([], emptyGate, process.cwd());
  return buildBenchmarkApiEnvelope(emptyPayload, {
    runner: "effect-benchmark",
    thresholdSource: "default",
    gate: emptyGate,
    ok: false,
    requestError,
    retryAfterMs: overrides?.retryAfterMs,
    mapTaxonomy: true,
  });
}

export function resetBenchmarkApiState(): void {
  lastGoodEnvelope = null;
  lastGoodAt = null;
}

/** Human-readable summary for kimi-doctor --perf-gates (non-JSON). */
export function formatPerfGatesHuman(envelope: BenchmarkApiEnvelope): string {
  const lines: string[] = [];
  lines.push(
    `Effect benchmarks — ${envelope.summary.passing}/${envelope.summary.measured} passing`
  );
  lines.push(`Threshold source: ${envelope.thresholdSource}`);
  lines.push(`Gate: ${envelope.gates.effectBenchmarkGate.status.toUpperCase()}`);
  if (envelope.gates.effectBenchmarkGate.reason) {
    lines.push(`  └─ ${envelope.gates.effectBenchmarkGate.reason}`);
  }
  for (const family of sortedFamilyKeys(envelope.families)) {
    const rows = envelope.families[family] ?? [];
    lines.push(`${family} (${rows.length})`);
    for (const row of rows) {
      const mark = row.skipped ? "↷" : row.pass ? "✓" : "✗";
      const time = row.skipped ? "—" : `${row.actualMs.toFixed(3)}ms`;
      lines.push(`  ${mark} ${row.name} ${time} [${row.thresholdSource}]`);
    }
  }
  if (envelope.taxonomyErrors?.length) {
    lines.push("Issues:");
    for (const err of envelope.taxonomyErrors.slice(0, 5)) {
      lines.push(`  [${err.type}] ${err.details}`);
    }
  }
  return lines.join("\n");
}
