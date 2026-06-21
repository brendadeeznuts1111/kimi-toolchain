/**
 * Strategy Check Gate (L2 — strategic)
 *
 * Evaluates overall strategy health after L1 gates pass.
 * Depends on health-check and data-freshness.
 */

import type { Gate, GateResult } from "./types.ts";

export interface StrategyCheckResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: { healthScore: number; freshnessScore: number };
  timestamp: string;
}

export async function runStrategyCheckGate(): Promise<StrategyCheckResult> {
  // Simulate composite scoring from upstream L1 gates
  const healthScore = 0.85 + Math.random() * 0.15;
  const freshnessScore = 0.9 + Math.random() * 0.1;

  let status: StrategyCheckResult["status"] = "pass";
  if (healthScore < 0.6 || freshnessScore < 0.6) status = "fail";
  else if (healthScore < 0.8 || freshnessScore < 0.8) status = "warn";

  return {
    status,
    reason:
      status === "pass"
        ? undefined
        : `health: ${Math.round(healthScore * 100)}%, freshness: ${Math.round(freshnessScore * 100)}%`,
    metrics: { healthScore, freshnessScore },
    timestamp: new Date().toISOString(),
  };
}

export const strategyCheckGateDefinition: Gate = {
  name: "strategy-check",
  description: "Composite strategy health after L1 gates (L2)",
  level: 2,
  dependsOn: ["health-check", "data-freshness"],
  parallel: false,
  run: runStrategyCheckGate,
  format: (result) => {
    const row = result as StrategyCheckResult;
    return [
      `${row.status}: strategy-check` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ health: ${Math.round(row.metrics.healthScore * 100)}% | freshness: ${Math.round(row.metrics.freshnessScore * 100)}%`,
    ];
  },
};
