/**
 * Data Freshness Gate (L1 — tactical)
 *
 * Simulates data feed lag and missing ticks. Replace with real
 * feed health checks in production.
 */

import type { Gate, GateResult } from "./types.ts";

export interface DataFreshnessResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: { lagMs: number; missingTicks: number };
  timestamp: string;
}

function statusFromMetrics(metrics: DataFreshnessResult["metrics"]): DataFreshnessResult["status"] {
  if (metrics.lagMs > 5000 || metrics.missingTicks > 10) return "fail";
  if (metrics.lagMs > 2000 || metrics.missingTicks > 3) return "warn";
  return "pass";
}

export async function runDataFreshnessGate(): Promise<DataFreshnessResult> {
  const day = new Date().getDate();
  const metrics = {
    lagMs: 80 + (day % 7) * 40,
    missingTicks: day % 5 === 0 ? 2 : 0,
  };
  const status = statusFromMetrics(metrics);

  return {
    status,
    reason:
      status === "pass"
        ? undefined
        : `lag ${metrics.lagMs}ms, missing ${metrics.missingTicks} ticks`,
    metrics,
    timestamp: new Date().toISOString(),
  };
}

export const dataFreshnessGateDefinition: Gate = {
  name: "data-freshness",
  description: "Data lag and missing tick detection (L1)",
  level: 1,
  dependsOn: [],
  parallel: true,
  run: runDataFreshnessGate,
  format: (result) => {
    const row = result as DataFreshnessResult;
    return [
      `${row.status}: data-freshness` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ lag: ${row.metrics.lagMs}ms | missing ticks: ${row.metrics.missingTicks}`,
    ];
  },
};
