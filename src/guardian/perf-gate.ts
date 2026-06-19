import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
  if (!existsSync(thresholdsPath)) return {};
  try {
    return JSON.parse(readFileSync(thresholdsPath, "utf8")) as Record<string, number>;
  } catch {
    return {};
  }
}

function effectiveThreshold(metric: Metric, trained: Record<string, number>): number {
  return trained[metricKey(metric)] ?? metric.thresholdMs;
}

function metricPasses(metric: Metric, trained: Record<string, number>): boolean {
  const threshold = effectiveThreshold(metric, trained);
  return !Number.isNaN(metric.actualMs) && metric.actualMs <= threshold;
}

export function perfGate(metrics: readonly Metric[]): PerfGateResult {
  const trained = loadTrainedThresholds();
  const failures: string[] = [];

  for (const metric of metrics) {
    if (metricPasses(metric, trained)) continue;
    const threshold = effectiveThreshold(metric, trained);
    failures.push(`${metricKey(metric)}: ${metric.actualMs}ms > ${threshold}ms`);
  }

  return { pass: failures.length === 0, failures };
}
