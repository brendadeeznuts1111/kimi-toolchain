/**
 * Risk Limits Gate (L1 — tactical)
 *
 * Position sizing, VaR, and margin utilization. Scaffold stub.
 */
import type { Gate, GateResult, GateRunOptions } from "./types.ts";
import { GATE_LEVEL_PRUNE_MS } from "./types.ts";

export interface RiskLimitsResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: { varBps: number; marginUsedPct: number; positionCount: number };
  timestamp: string;
}

function statusFromMetrics(metrics: RiskLimitsResult["metrics"]): RiskLimitsResult["status"] {
  if (metrics.varBps > 400 || metrics.marginUsedPct > 90) return "fail";
  if (metrics.varBps > 250 || metrics.marginUsedPct > 75) return "warn";
  return "pass";
}

export async function runRiskLimitsGate(_opts: GateRunOptions = {}): Promise<RiskLimitsResult> {
  const day = new Date().getDate();
  const metrics = {
    varBps: 120 + (day % 9) * 25,
    marginUsedPct: 35 + (day % 6) * 8,
    positionCount: 4 + (day % 3),
  };
  const status = statusFromMetrics(metrics);

  return {
    status,
    reason:
      status === "pass" ? undefined : `VaR ${metrics.varBps} bps, margin ${metrics.marginUsedPct}%`,
    metrics,
    timestamp: new Date().toISOString(),
  };
}

export const riskLimitsGateDefinition: Gate = {
  name: "risk-limits",
  description: "Position sizing, VaR, and margin checks (L1)",
  level: 1,
  dependsOn: [],
  parallel: true,
  retentionPolicy: { maxAgeMs: 24 * 60 * 60 * 1000, maxCount: 288 },
  run: runRiskLimitsGate,
  format: (result) => {
    const row = result as RiskLimitsResult;
    return [
      `${row.status}: risk-limits` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ VaR: ${row.metrics.varBps} bps | margin: ${row.metrics.marginUsedPct}% | positions: ${row.metrics.positionCount}`,
      `       └─ prune: ${GATE_LEVEL_PRUNE_MS[1] / (24 * 3600 * 1000)} days`,
    ];
  },
};
