import { isAbsolute, relative } from "node:path";
import type { Metric } from "../harness/html-reporter.ts";
import { BUN_BENCHMARKING_DOC_URL } from "./bun-install-config.ts";

export interface PerfGateFailureDetails {
  thresholdSourceFile?: string;
  thresholdLineNumber?: number;
  lastTrainedAt?: string;
}

function metricKey(metric: Metric): string {
  return metric.registryKey ?? `${metric.symbol}.${metric.operation}`;
}

function formatMs(value: number): string {
  return Number.isNaN(value) ? "NaNms" : `${value}ms`;
}

function displayPath(path: string): string {
  if (!isAbsolute(path)) return path;
  const rel = relative(process.cwd(), path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function formatLocation(file?: string, line?: number): string | undefined {
  if (!file) return undefined;
  return `${displayPath(file)}${line ? `:${line}` : ""}`;
}

export function formatPerfGateFailure(
  metric: Metric,
  threshold: number,
  details: PerfGateFailureDetails = {}
): string {
  const lines = [
    `fail: ${metricKey(metric)} exceeded threshold (${formatMs(metric.actualMs)} > ${formatMs(threshold)})`,
  ];

  const source = formatLocation(metric.sourceFile, metric.lineNumber);
  if (source) {
    lines.push(
      `       └─ source: ${source}${metric.sourceDescription ? ` (${metric.sourceDescription})` : ""}`
    );
  }

  lines.push(`       └─ symbol: ${metric.symbol}`);
  lines.push(`       └─ operation: ${metric.operation}`);

  const thresholdSource = formatLocation(details.thresholdSourceFile, details.thresholdLineNumber);
  lines.push(
    `       └─ threshold: ${formatMs(threshold)}${thresholdSource ? ` (set in ${thresholdSource})` : ""}`
  );

  if (details.lastTrainedAt) {
    lines.push(`       └─ last trained: ${details.lastTrainedAt}`);
  }

  return lines.join("\n");
}

/** LLM/grep-friendly profiling commands when perf gates fail (@see Bun benchmarking docs). */
export function formatPerfProfilingHints(script = "run bench"): string {
  return [
    "perf profiling (@see bun.com/docs/project/benchmarking):",
    `  bun --cpu-prof-md ${script}`,
    `  bun --heap-prof-md ${script}`,
    `  MIMALLOC_SHOW_STATS=1 bun ${script}`,
    `  docs: ${BUN_BENCHMARKING_DOC_URL}`,
  ].join("\n");
}

/** Append profiling hints once when a gate reported failures. */
export function withPerfProfilingHints(failures: readonly string[]): string[] {
  if (failures.length === 0) return [...failures];
  return [...failures, formatPerfProfilingHints()];
}
