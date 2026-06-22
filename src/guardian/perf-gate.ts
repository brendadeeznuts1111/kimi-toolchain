import { join } from "node:path";
import { pathExists, readText } from "../lib/bun-io.ts";
import { formatPerfGateFailure } from "../lib/perf-gate-format.ts";
import type { Metric } from "../harness/html-reporter.ts";

export interface PerfGateResult {
  pass: boolean;
  failures: string[];
}

let thresholdsPath = join(process.cwd(), "thresholds.json");

/** Test-only: point perfGate at a specific thresholds.json path. */
export function setThresholdsPath(path: string): void {
  thresholdsPath = path;
}

/** Test-only: reset thresholds path to cwd/thresholds.json. */
export function resetThresholdsPath(): void {
  thresholdsPath = join(process.cwd(), "thresholds.json");
}

function metricKey(metric: Metric): string {
  return `${metric.symbol}.${metric.operation}`;
}

function loadTrainedThresholds(): Record<string, number> {
  if (!pathExists(thresholdsPath)) return {};
  try {
    return JSON.parse(readText(thresholdsPath)) as Record<string, number>;
  } catch {
    return {};
  }
}

function effectiveThreshold(metric: Metric, trained: Record<string, number>): number {
  return trained[metricKey(metric)] ?? metric.thresholdMs;
}

function trainedThresholdLastModified(): string | undefined {
  if (!pathExists(thresholdsPath)) return undefined;
  const lastModified = Bun.file(thresholdsPath).lastModified;
  return Number.isFinite(lastModified) && lastModified > 0
    ? new Date(lastModified).toISOString()
    : undefined;
}

function metricPasses(metric: Metric, trained: Record<string, number>): boolean {
  const threshold = effectiveThreshold(metric, trained);
  return !Number.isNaN(metric.actualMs) && metric.actualMs <= threshold;
}

export function perfGate(metrics: readonly Metric[]): PerfGateResult {
  const trained = loadTrainedThresholds();
  const lastTrainedAt = trainedThresholdLastModified();
  const failures: string[] = [];

  for (const metric of metrics) {
    if (metricPasses(metric, trained)) continue;
    const threshold = effectiveThreshold(metric, trained);
    failures.push(
      formatPerfGateFailure(metric, threshold, {
        thresholdSourceFile: trained[metricKey(metric)] === undefined ? undefined : thresholdsPath,
        lastTrainedAt: trained[metricKey(metric)] === undefined ? undefined : lastTrainedAt,
      })
    );
  }

  return { pass: failures.length === 0, failures };
}
