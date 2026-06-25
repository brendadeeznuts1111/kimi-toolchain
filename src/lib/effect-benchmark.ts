/**
 * effect-benchmark.ts — Closed-loop benchmark harness for effect handlers.
 *
 * Every handler that registers itself via `registerEffectBenchmark` is:
 *   - Measured: median latency over KIMI_EFFECT_BENCHMARK_ITERATIONS
 *   - Trained: thresholds learned from measured medians + margin
 *   - Gated: actual median compared to trained/default threshold
 *   - Regressed: compared against the previous snapshot in .kimi/var/effect-benchmark.ndjson
 *   - Artifacted: rendered to a living HTML dashboard
 *
 * Threshold layers (lowest precedence first):
 *   thresholds.baseline.json → .kimi/thresholds.local.json → thresholds.json (legacy)
 */

import { join } from "path";
import { formatPerfGateFailure, withPerfProfilingHints } from "./perf-gate-format.ts";
import {
  effectBenchmarkSnapshotsPath,
  thresholdsBaselinePath,
  thresholdsLegacyPath,
  thresholdsLocalPath,
} from "./paths.ts";
import { getProjectName, safeParse } from "./utils.ts";
import type { Metric, ReportMeta } from "../harness/html-reporter.ts";
import { generatePerfHtml } from "../harness/html-reporter.ts";

export interface EffectBenchmarkEntry {
  /** Registry key used for thresholds and snapshots, e.g. "crypto.sha256". */
  registryKey: string;
  /** Handler symbol, e.g. "kimi.effect.crypto". */
  symbol: string;
  /** Operation name — defaults to the segment after the last dot of registryKey. */
  operation?: string;
  /** Default threshold in ms — falls back to KIMI_EFFECT_BENCHMARK_DEFAULT_THRESHOLD_MS. */
  thresholdMs?: number;
  /** Source file that owns or registers the measured operation. */
  sourceFile?: string;
  lineNumber?: number;
  sourceDescription?: string;
  /** Workload to benchmark. May be sync or async. */
  workload: () => unknown | Promise<unknown>;
  /** When true, the benchmark is skipped and recorded as passing. */
  skipIf?: () => boolean | Promise<boolean>;
  skipReason?: string;
}

export interface BenchmarkOptions {
  /** Measured iterations; overrides KIMI_EFFECT_BENCHMARK_ITERATIONS. */
  iterations?: number;
  /** Warmup iterations; overrides KIMI_EFFECT_BENCHMARK_WARMUP. */
  warmup?: number;
  /** Filter to specific registry keys; null/undefined runs all registered handlers. */
  registryKeys?: string[] | null;
  /** Project root for snapshot I/O and layered thresholds. Defaults to process.cwd(). */
  projectRoot?: string;
  /**
   * Legacy single-file thresholds path. When set, layered merge is skipped and only
   * this file is loaded (used by isolated test dirs).
   */
  thresholdsPath?: string;
  /** Wall-clock budget for the full run; defaults to KIMI_EFFECT_BENCHMARK_RUN_TIMEOUT_MS when set via report API. */
  timeoutMs?: number;
}

export interface BenchmarkHandlerError {
  registryKey: string;
  message: string;
}

export interface BenchmarkRunReport {
  metrics: Metric[];
  errors: BenchmarkHandlerError[];
  timedOut: boolean;
  partialSuccess: boolean;
}

export interface PerfGateResult {
  pass: boolean;
  failures: string[];
}

export interface TrainResult {
  written: boolean;
  /** Primary path written (baseline when layered; thresholds.json in legacy mode). */
  path: string;
  /** All paths written during training. */
  paths: string[];
  thresholds: Record<string, number>;
}

export interface BenchmarkRegression {
  registryKey: string;
  previousMs: number;
  currentMs: number;
  tolerance: number;
  message: string;
}

export interface EffectBenchmarkSnapshot {
  schemaVersion: number;
  tool: string;
  generatedAt: string;
  project: string;
  gitHead?: string;
  metrics: Metric[];
}

export interface MergedThresholds {
  thresholds: Record<string, number>;
  sources: Record<string, string>;
}

const SCHEMA_VERSION = 1;
const REGISTRY_SYMBOL = Symbol.for("kimi.effect.benchmarks");
const MIN_REGRESSION_DELTA_MS = 0.1;

function getRegistry(): EffectBenchmarkEntry[] {
  const global = globalThis as Record<symbol, unknown>;
  const existing = global[REGISTRY_SYMBOL];
  if (Array.isArray(existing)) return existing as EffectBenchmarkEntry[];
  const registry: EffectBenchmarkEntry[] = [];
  global[REGISTRY_SYMBOL] = registry;
  return registry;
}

/** Register an effect handler for automatic benchmarking. Idempotent by registryKey. */
export function registerEffectBenchmark(entry: EffectBenchmarkEntry): void {
  const registry = getRegistry();
  const registrationSource = captureRegistrationSource();
  const nextEntry = {
    ...entry,
    sourceFile: entry.sourceFile ?? registrationSource?.sourceFile,
    lineNumber: entry.lineNumber ?? registrationSource?.lineNumber,
    sourceDescription: entry.sourceDescription ?? "registered benchmark",
  };
  const index = registry.findIndex((e) => e.registryKey === entry.registryKey);
  if (index >= 0) registry[index] = nextEntry;
  else registry.push(nextEntry);
}

/** Discover all registered effect benchmarks. */
export function discoverEffectBenchmarks(): EffectBenchmarkEntry[] {
  return getRegistry().slice();
}

/** Test-only: clear the global benchmark registry. */
export function resetEffectBenchmarkRegistry(): void {
  const registry = getRegistry();
  registry.length = 0;
}

/** Host-specific benchmarks train into .kimi/thresholds.local.json (gitignored overlay). */
export function isHostSpecificBenchmarkKey(registryKey: string): boolean {
  if (registryKey.startsWith("httpClient.")) return true;
  if (registryKey.startsWith("http.fetch-")) return true;
  if (registryKey.startsWith("isolation.")) return true;
  if (registryKey.startsWith("file.serve-")) return true;
  if (registryKey === "email-i18n" || registryKey === "clock" || registryKey === "uuid") {
    return true;
  }
  return false;
}

function defaultThreshold(): number {
  return KIMI_EFFECT_BENCHMARK_DEFAULT_THRESHOLD_MS;
}

function benchmarkOptions(
  opts?: BenchmarkOptions
): Required<Pick<BenchmarkOptions, "iterations" | "warmup">> {
  return {
    iterations: opts?.iterations ?? KIMI_EFFECT_BENCHMARK_ITERATIONS,
    warmup: opts?.warmup ?? KIMI_EFFECT_BENCHMARK_WARMUP,
  };
}

function normalizeRoot(path: string): string {
  return path.replace(/\/$/, "");
}

function projectRootFrom(opts?: BenchmarkOptions): string {
  return normalizeRoot(opts?.projectRoot ?? process.cwd());
}

function shouldUseLayeredThresholds(outDir?: string): boolean {
  if (!outDir) return true;
  return normalizeRoot(outDir) === normalizeRoot(process.cwd());
}

async function loadThresholdFile(path: string): Promise<Record<string, number>> {
  const file = Bun.file(path);
  if (await file.exists()) return (await file.json()) as Record<string, number>;
  return {};
}

function assignLayerSources(
  sources: Record<string, string>,
  thresholds: Record<string, number>,
  path: string
): void {
  for (const key of Object.keys(thresholds)) {
    sources[key] = path;
  }
}

/** Merge baseline → local → legacy thresholds for a project root. */
export async function loadMergedEffectBenchmarkThresholds(
  projectRoot: string
): Promise<MergedThresholds> {
  const baselinePath = thresholdsBaselinePath(projectRoot);
  const localPath = thresholdsLocalPath(projectRoot);
  const legacyPath = thresholdsLegacyPath(projectRoot);

  const baseline = await loadThresholdFile(baselinePath);
  const local = await loadThresholdFile(localPath);
  const legacy = await loadThresholdFile(legacyPath);

  const thresholds = { ...baseline, ...local, ...legacy };
  const sources: Record<string, string> = {};
  assignLayerSources(sources, baseline, baselinePath);
  assignLayerSources(sources, local, localPath);
  assignLayerSources(sources, legacy, legacyPath);

  return { thresholds, sources };
}

async function resolveTrainedThresholds(opts?: BenchmarkOptions): Promise<MergedThresholds> {
  if (opts?.thresholdsPath) {
    const thresholds = await loadThresholdFile(opts.thresholdsPath);
    const sources = Object.fromEntries(
      Object.keys(thresholds).map((key) => [key, opts.thresholdsPath!])
    );
    return { thresholds, sources };
  }
  return loadMergedEffectBenchmarkThresholds(projectRootFrom(opts));
}

function trainedThresholdLastModified(path: string): string | undefined {
  const lastModified = Bun.file(path).lastModified;
  return Number.isFinite(lastModified) && lastModified > 0
    ? new Date(lastModified).toISOString()
    : undefined;
}

function captureRegistrationSource():
  | Pick<EffectBenchmarkEntry, "sourceFile" | "lineNumber">
  | undefined {
  const stack = new Error().stack;
  if (!stack) return undefined;

  for (const line of stack.split("\n")) {
    if (line.includes("effect-benchmark.ts")) continue;
    const match = line.match(/\(?((?:file:\/\/)?[^():]+\.ts):(\d+):(\d+)\)?/);
    if (!match) continue;
    const sourceFile = match[1]!.replace(/^file:\/\//, "");
    return { sourceFile, lineNumber: Number(match[2]) };
  }

  return undefined;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

function thresholdValue(margin: number, actualMs: number): number {
  return Math.max(0.01, Math.round(actualMs * margin * 1000) / 1000);
}

async function writeThresholdLayer(path: string, updates: Record<string, number>): Promise<void> {
  const existing = await loadThresholdFile(path);
  const merged = { ...existing, ...updates };
  await Bun.write(path, `${JSON.stringify(merged, null, 2)}\n`, { createPath: true });
}

async function runEntry(
  entry: EffectBenchmarkEntry,
  opts: Required<Pick<BenchmarkOptions, "iterations" | "warmup">>,
  trained: Record<string, number>
): Promise<Metric> {
  const operation = entry.operation ?? entry.registryKey.split(".").pop() ?? entry.registryKey;

  if (entry.skipIf && (await entry.skipIf())) {
    return {
      symbol: entry.symbol,
      operation,
      actualMs: 0,
      thresholdMs: trained[entry.registryKey] ?? entry.thresholdMs ?? defaultThreshold(),
      pass: true,
      skipped: true,
      skipReason: entry.skipReason ?? "skipped",
      registryKey: entry.registryKey,
      sourceFile: entry.sourceFile,
      lineNumber: entry.lineNumber,
      sourceDescription: entry.sourceDescription,
    };
  }

  for (let i = 0; i < opts.warmup; i++) {
    try {
      await entry.workload();
    } catch {
      // warmup failures are ignored
    }
  }

  const times: number[] = [];
  for (let i = 0; i < opts.iterations; i++) {
    const start = Bun.nanoseconds();
    try {
      await entry.workload();
      times.push(Bun.nanoseconds() - start);
    } catch {
      return {
        symbol: entry.symbol,
        operation,
        actualMs: NaN,
        thresholdMs: trained[entry.registryKey] ?? entry.thresholdMs ?? defaultThreshold(),
        pass: false,
        registryKey: entry.registryKey,
        sourceFile: entry.sourceFile,
        lineNumber: entry.lineNumber,
        sourceDescription: entry.sourceDescription,
      };
    }
  }

  const actualNs = median(times);
  const actualMs = actualNs / 1_000_000;
  const thresholdMs = trained[entry.registryKey] ?? entry.thresholdMs ?? defaultThreshold();
  return {
    symbol: entry.symbol,
    operation,
    actualMs: Math.round(actualMs * 1000) / 1000,
    thresholdMs,
    pass: !Number.isNaN(actualMs) && actualMs <= thresholdMs,
    registryKey: entry.registryKey,
    sourceFile: entry.sourceFile,
    lineNumber: entry.lineNumber,
    sourceDescription: entry.sourceDescription,
  };
}

function failureMetric(entry: EffectBenchmarkEntry, trained: Record<string, number>): Metric {
  const operation = entry.operation ?? entry.registryKey.split(".").pop() ?? entry.registryKey;
  return {
    symbol: entry.symbol,
    operation,
    actualMs: NaN,
    thresholdMs: trained[entry.registryKey] ?? entry.thresholdMs ?? defaultThreshold(),
    pass: false,
    registryKey: entry.registryKey,
    sourceFile: entry.sourceFile,
    lineNumber: entry.lineNumber,
    sourceDescription: entry.sourceDescription,
  };
}

async function runEntrySafe(
  entry: EffectBenchmarkEntry,
  opts: Required<Pick<BenchmarkOptions, "iterations" | "warmup">>,
  trained: Record<string, number>
): Promise<{ metric: Metric; error?: BenchmarkHandlerError }> {
  try {
    const metric = await runEntry(entry, opts, trained);
    if (!metric.skipped && Number.isNaN(metric.actualMs)) {
      return {
        metric,
        error: { registryKey: entry.registryKey, message: "workload failed" },
      };
    }
    return { metric };
  } catch (error) {
    const message = error instanceof Error ? error.message : Bun.inspect(error);
    return {
      metric: failureMetric(entry, trained),
      error: { registryKey: entry.registryKey, message },
    };
  }
}

/** Measure handlers and return metrics plus resilience metadata. */
export async function runEffectBenchmarksReport(
  opts?: BenchmarkOptions
): Promise<BenchmarkRunReport> {
  const entries = discoverEffectBenchmarks();
  const keys = opts?.registryKeys;
  const filtered =
    keys === undefined || keys === null
      ? entries
      : entries.filter((e) => keys.includes(e.registryKey));

  const { iterations, warmup } = benchmarkOptions(opts);
  const { thresholds: trained } = await resolveTrainedThresholds(opts);
  const timeoutMs = opts?.timeoutMs ?? KIMI_EFFECT_BENCHMARK_RUN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  const metrics: Metric[] = [];
  const errors: BenchmarkHandlerError[] = [];
  let timedOut = false;

  for (let i = 0; i < filtered.length; i++) {
    const entry = filtered[i]!;
    if (Date.now() >= deadline) {
      timedOut = true;
      for (let j = i; j < filtered.length; j++) {
        const skipped = filtered[j]!;
        errors.push({
          registryKey: skipped.registryKey,
          message: "skipped: benchmark run timed out",
        });
      }
      break;
    }

    const result = await runEntrySafe(entry, { iterations, warmup }, trained);
    metrics.push(result.metric);
    if (result.error) errors.push(result.error);
  }

  const measured = metrics.filter((m) => !m.skipped);
  const partialSuccess =
    measured.some((m) => m.pass && !Number.isNaN(m.actualMs)) && (errors.length > 0 || timedOut);

  return { metrics, errors, timedOut, partialSuccess };
}

/** Measure every registered effect handler and return Metric rows. */
export async function runEffectBenchmarks(opts?: BenchmarkOptions): Promise<Metric[]> {
  return (await runEffectBenchmarksReport(opts)).metrics;
}

/** Train thresholds from passing metrics into layered or legacy threshold files. */
export async function trainEffectThresholds(
  metrics: Metric[],
  outDir?: string,
  margin = KIMI_EFFECT_BENCHMARK_TRAIN_MARGIN
): Promise<TrainResult> {
  const measured = metrics.filter((m) => !m.skipped);
  const allPass = measured.every((m) => m.pass && !Number.isNaN(m.actualMs));
  const root = normalizeRoot(outDir ?? process.cwd());
  const legacyPath = outDir
    ? join(normalizeRoot(outDir), "thresholds.json")
    : thresholdsLegacyPath(process.cwd());

  if (!allPass) {
    return { written: false, path: legacyPath, paths: [], thresholds: {} };
  }

  const portable: Record<string, number> = {};
  const hostSpecific: Record<string, number> = {};
  const combined: Record<string, number> = {};

  for (const m of measured) {
    const key = m.registryKey ?? m.operation;
    const value = thresholdValue(margin, m.actualMs);
    combined[key] = value;
    if (isHostSpecificBenchmarkKey(key)) {
      hostSpecific[key] = value;
    } else {
      portable[key] = value;
    }
  }

  if (!shouldUseLayeredThresholds(outDir)) {
    await writeThresholdLayer(legacyPath, combined);
    return { written: true, path: legacyPath, paths: [legacyPath], thresholds: combined };
  }

  const writtenPaths: string[] = [];
  if (Object.keys(portable).length > 0) {
    const baselinePath = thresholdsBaselinePath(root);
    await writeThresholdLayer(baselinePath, portable);
    writtenPaths.push(baselinePath);
  }
  if (Object.keys(hostSpecific).length > 0) {
    const localPath = thresholdsLocalPath(root);
    await writeThresholdLayer(localPath, hostSpecific);
    writtenPaths.push(localPath);
  }

  return {
    written: writtenPaths.length > 0,
    path: writtenPaths[0] ?? thresholdsBaselinePath(root),
    paths: writtenPaths,
    thresholds: combined,
  };
}

/** Evaluate metrics against trained/default thresholds. */
export async function evaluateEffectBenchmarkGate(
  metrics: Metric[],
  thresholdsPath?: string,
  projectRoot?: string
): Promise<PerfGateResult> {
  let trained: Record<string, number>;
  let sources: Record<string, string>;
  if (thresholdsPath) {
    trained = await loadThresholdFile(thresholdsPath);
    sources = Object.fromEntries(Object.keys(trained).map((key) => [key, thresholdsPath]));
  } else {
    ({ thresholds: trained, sources } = await loadMergedEffectBenchmarkThresholds(
      normalizeRoot(projectRoot ?? process.cwd())
    ));
  }

  const failures: string[] = [];

  for (const m of metrics) {
    if (m.skipped) continue;
    const key = m.registryKey ?? m.operation;
    const trainedValue = trained[key];
    const threshold = trainedValue ?? m.thresholdMs;
    if (Number.isNaN(m.actualMs) || m.actualMs > threshold) {
      const sourcePath = trainedValue === undefined ? undefined : sources[key];
      failures.push(
        formatPerfGateFailure(m, threshold, {
          thresholdSourceFile: sourcePath,
          lastTrainedAt: sourcePath ? trainedThresholdLastModified(sourcePath) : undefined,
        })
      );
    }
  }

  return { pass: failures.length === 0, failures: withPerfProfilingHints(failures) };
}

/** Detect latency regressions between current metrics and a previous snapshot. */
export function detectBenchmarkRegressions(
  current: Metric[],
  previous: Metric[],
  tolerance = KIMI_EFFECT_BENCHMARK_REGRESSION_TOLERANCE
): BenchmarkRegression[] {
  const previousByKey = new Map(previous.map((m) => [m.registryKey ?? m.operation, m]));
  const regressions: BenchmarkRegression[] = [];

  for (const m of current) {
    if (m.skipped || Number.isNaN(m.actualMs)) continue;
    const prev = previousByKey.get(m.registryKey ?? m.operation);
    if (!prev || prev.skipped || Number.isNaN(prev.actualMs)) continue;
    const delta = m.actualMs - prev.actualMs;
    if (delta > MIN_REGRESSION_DELTA_MS && m.actualMs > prev.actualMs * tolerance) {
      const key = m.registryKey ?? m.operation;
      regressions.push({
        registryKey: key,
        previousMs: prev.actualMs,
        currentMs: m.actualMs,
        tolerance,
        message: `Regression: ${key} ${prev.actualMs}ms → ${m.actualMs}ms (tolerance ${tolerance})`,
      });
    }
  }

  return regressions;
}

function projectRootOrCwd(projectRoot?: string): string {
  return projectRoot ?? process.cwd();
}

/** Append a benchmark snapshot to the project NDJSON log (rotated to max runs). */
export async function appendBenchmarkSnapshot(
  projectRoot: string,
  metrics: Metric[],
  options?: { tool?: string; gitHead?: string }
): Promise<EffectBenchmarkSnapshot> {
  const root = projectRootOrCwd(projectRoot);
  const snapshot: EffectBenchmarkSnapshot = {
    schemaVersion: SCHEMA_VERSION,
    tool: options?.tool ?? "kimi-effect-benchmark",
    generatedAt: new Date().toISOString(),
    project: await getProjectName(root),
    gitHead: options?.gitHead,
    metrics,
  };

  const path = effectBenchmarkSnapshotsPath(root);
  const file = Bun.file(path);
  const lines = (await file.exists())
    ? (await file.text())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  lines.push(JSON.stringify(snapshot));
  const maxRuns = KIMI_EFFECT_BENCHMARK_SNAPSHOT_MAX_RUNS;
  const rotated = lines.length > maxRuns ? lines.slice(-maxRuns) : lines;
  await Bun.write(path, `${rotated.map((line) => `${line}\n`).join("")}`, { createPath: true });
  return snapshot;
}

/** Read recent benchmark snapshots, newest first. */
export async function readBenchmarkSnapshots(
  projectRoot: string,
  limit = 10
): Promise<EffectBenchmarkSnapshot[]> {
  const path = effectBenchmarkSnapshotsPath(projectRoot);
  const file = Bun.file(path);
  if (!(await file.exists())) return [];

  const text = await file.text();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .slice(0, limit);

  return lines
    .map((line) =>
      safeParse<EffectBenchmarkSnapshot>(line, null as unknown as EffectBenchmarkSnapshot)
    )
    .filter(
      (s): s is EffectBenchmarkSnapshot =>
        s !== null && typeof s === "object" && s.schemaVersion === SCHEMA_VERSION
    );
}

/** Render an HTML dashboard artifact from metrics and optional metadata. */
export function generateBenchmarkHtml(
  metrics: Metric[],
  options?: { title?: string; meta?: ReportMeta }
): string {
  return generatePerfHtml(metrics, options?.title ?? "Effect Handler Benchmarks", options?.meta);
}

/** Convenience: run, gate, and optionally train/report/regress in one call. */
export interface BenchmarkRunResult {
  metrics: Metric[];
  gate: PerfGateResult;
  regressions: BenchmarkRegression[];
  snapshot: EffectBenchmarkSnapshot | null;
}

export async function runBenchmarkLoop(
  options: BenchmarkOptions & {
    projectRoot?: string;
    gitHead?: string;
    train?: boolean;
    reportPath?: string;
    detectRegression?: boolean;
  }
): Promise<BenchmarkRunResult> {
  const root = projectRootOrCwd(options.projectRoot);
  const metrics = await runEffectBenchmarks(options);
  const gate = await evaluateEffectBenchmarkGate(
    metrics,
    options.thresholdsPath,
    options.projectRoot
  );

  let regressions: BenchmarkRegression[] = [];
  if (options.detectRegression) {
    const previous = (await readBenchmarkSnapshots(root, 1))[0];
    if (previous) {
      regressions = detectBenchmarkRegressions(metrics, previous.metrics);
    }
  }

  let snapshot: EffectBenchmarkSnapshot | null = null;
  if (options.train && gate.pass && regressions.length === 0) {
    await trainEffectThresholds(metrics, root);
  }
  if (options.detectRegression || options.reportPath) {
    snapshot = await appendBenchmarkSnapshot(root, metrics, { gitHead: options.gitHead });
  }

  if (options.reportPath) {
    const previous = (await readBenchmarkSnapshots(root, 10)).slice(1);
    const meta: ReportMeta = {
      generatedAt: snapshot?.generatedAt,
      gitHead: options.gitHead,
      regressionCount: regressions.length,
      snapshotCount: previous.length + 1,
    };
    const html = generateBenchmarkHtml(metrics, { title: "Effect Handler Benchmarks", meta });
    await Bun.write(options.reportPath, html, { createPath: true });
  }

  return { metrics, gate, regressions, snapshot };
}
