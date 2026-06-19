/**
 * effect-benchmark.ts — Closed-loop benchmark harness for effect handlers.
 *
 * Every handler that registers itself via `registerEffectBenchmark` is:
 *   - Measured: median latency over KIMI_EFFECT_BENCHMARK_ITERATIONS
 *   - Trained: thresholds learned from measured medians + margin
 *   - Gated: actual median compared to trained/default threshold
 *   - Regressed: compared against the previous snapshot in .kimi/var/effect-benchmark.ndjson
 *   - Artifacted: rendered to a living HTML dashboard
 */

import { join } from "path";
import { effectBenchmarkSnapshotsPath } from "./paths.ts";
import { getProjectName, safeParse } from "./utils.ts";
import type { Metric, ReportMeta } from "../harness/html-reporter.ts";
import { generatePerfHTML } from "../harness/html-reporter.ts";

export interface EffectBenchmarkEntry {
  /** Registry key used for thresholds and snapshots, e.g. "crypto.sha256". */
  registryKey: string;
  /** Handler symbol, e.g. "kimi.effect.crypto". */
  symbol: string;
  /** Operation name — defaults to the segment after the last dot of registryKey. */
  operation?: string;
  /** Default threshold in ms — falls back to KIMI_EFFECT_BENCHMARK_DEFAULT_THRESHOLD_MS. */
  thresholdMs?: number;
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
  /** Project root for snapshot I/O. Defaults to process.cwd(). */
  projectRoot?: string;
  /** Path to trained thresholds.json. Defaults to {cwd}/thresholds.json. */
  thresholdsPath?: string;
}

export interface PerfGateResult {
  pass: boolean;
  failures: string[];
}

export interface TrainResult {
  written: boolean;
  path: string;
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
  const index = registry.findIndex((e) => e.registryKey === entry.registryKey);
  if (index >= 0) registry[index] = entry;
  else registry.push(entry);
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

async function loadTrainedThresholds(path: string): Promise<Record<string, number>> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) return (await file.json()) as Record<string, number>;
  } catch {
    // ignore malformed thresholds file
  }
  return {};
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
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
  };
}

/** Measure every registered effect handler and return Metric rows. */
export async function runEffectBenchmarks(opts?: BenchmarkOptions): Promise<Metric[]> {
  const entries = discoverEffectBenchmarks();
  const keys = opts?.registryKeys;
  const filtered =
    keys === undefined || keys === null
      ? entries
      : entries.filter((e) => keys.includes(e.registryKey));

  const { iterations, warmup } = benchmarkOptions(opts);
  const thresholdsPath = opts?.thresholdsPath ?? join(process.cwd(), "thresholds.json");
  const trained = await loadTrainedThresholds(thresholdsPath);

  const metrics: Metric[] = [];
  for (const entry of filtered) {
    metrics.push(await runEntry(entry, { iterations, warmup }, trained));
  }
  return metrics;
}

/** Train thresholds from passing metrics and write thresholds.json. */
export async function trainEffectThresholds(
  metrics: Metric[],
  outDir?: string,
  margin = KIMI_EFFECT_BENCHMARK_TRAIN_MARGIN
): Promise<TrainResult> {
  const measured = metrics.filter((m) => !m.skipped);
  const allPass = measured.every((m) => m.pass && !Number.isNaN(m.actualMs));
  const path = outDir
    ? join(outDir.replace(/\/$/, ""), "thresholds.json")
    : join(process.cwd(), "thresholds.json");

  if (!allPass) {
    return { written: false, path, thresholds: {} };
  }

  const thresholds: Record<string, number> = {};
  for (const m of measured) {
    thresholds[m.registryKey ?? m.operation] = Math.max(
      0.01,
      Math.round(m.actualMs * margin * 1000) / 1000
    );
  }

  await Bun.write(path, `${JSON.stringify(thresholds, null, 2)}\n`, { createPath: true });
  return { written: true, path, thresholds };
}

/** Evaluate metrics against trained/default thresholds. */
export async function evaluateEffectBenchmarkGate(
  metrics: Metric[],
  thresholdsPath?: string
): Promise<PerfGateResult> {
  const path = thresholdsPath ?? join(process.cwd(), "thresholds.json");
  const trained = await loadTrainedThresholds(path);
  const failures: string[] = [];

  for (const m of metrics) {
    if (m.skipped) continue;
    const threshold = trained[m.registryKey ?? m.operation] ?? m.thresholdMs;
    if (Number.isNaN(m.actualMs) || m.actualMs > threshold) {
      failures.push(
        `${m.registryKey ?? m.operation}: ${m.actualMs}ms > ${threshold}ms (${m.symbol})`
      );
    }
  }

  return { pass: failures.length === 0, failures };
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

/** Append a benchmark snapshot to the project NDJSON log. */
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
  const existing = (await file.exists()) ? await file.text() : "";
  const record = `${JSON.stringify(snapshot)}\n`;
  await Bun.write(path, `${existing}${record}`, { createPath: true });
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
export function generateBenchmarkHTML(
  metrics: Metric[],
  options?: { title?: string; meta?: ReportMeta }
): string {
  return generatePerfHTML(metrics, options?.title ?? "Effect Handler Benchmarks", options?.meta);
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
  const gate = await evaluateEffectBenchmarkGate(metrics, options.thresholdsPath);

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
    const html = generateBenchmarkHTML(metrics, { title: "Effect Handler Benchmarks", meta });
    await Bun.write(options.reportPath, html, { createPath: true });
  }

  return { metrics, gate, regressions, snapshot };
}
