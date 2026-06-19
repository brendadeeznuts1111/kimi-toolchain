/**
 * Strategy Performance Gate (L2 — strategic)
 *
 * Demonstrates the artifact feedback loop: consumes L1 artifacts
 * (data-freshness, risk-limits) and produces a daily strategy health
 * snapshot.  Part of the trading-domain example in
 * `examples/artifact-trading-loop.md`.
 */
import type { Gate, GateResult, GateRunOptions } from "./types.ts";
import { GATE_LEVEL_PRUNE_MS, type GateRetentionPolicy } from "./types.ts";

const STRATEGY_RETENTION: GateRetentionPolicy = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxCount: 30,
};

export interface StrategyPerformanceResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: StrategyPerformanceMetrics;
  upstreamSummary: StrategyUpstreamSummary;
  timestamp: string;
}

export interface StrategyPerformanceMetrics {
  /** Daily P&L in basis points (simulated). */
  dailyPnlBps: number;
  /** Rolling 30-day Sharpe ratio (simulated). */
  sharpeRatio: number;
  /** Win rate 0-1 (simulated). */
  winRate: number;
  /** Maximum drawdown in basis points over the period. */
  maxDrawdownBps: number;
  /** Number of upstream artifacts consumed. */
  upstreamArtifactCount: number;
}

export interface StrategyUpstreamSummary {
  dataFreshness: { artifacts: number; latestStatus: string | null };
  riskLimits: { artifacts: number; latestStatus: string | null };
}

function statusFromMetrics(m: StrategyPerformanceMetrics): StrategyPerformanceResult["status"] {
  if (m.sharpeRatio < 0.5 || m.maxDrawdownBps > 500 || m.winRate < 0.35) return "fail";
  if (m.sharpeRatio < 1.0 || m.maxDrawdownBps > 300 || m.winRate < 0.45) return "warn";
  return "pass";
}

/**
 * Simulate strategy performance metrics.
 *
 * In production this would read from a real trading database or
 * position ledger.  Here we generate plausible values so the gate
 * always exercises the full artifact + lineage path.
 */
function computeMetrics(upstreamCount: number): StrategyPerformanceMetrics {
  // Scaffold: stable passing baseline; replace with real ledger reads in production.
  return {
    dailyPnlBps: 25 + upstreamCount * 3,
    sharpeRatio: 1.5,
    winRate: 0.52,
    maxDrawdownBps: 120,
    upstreamArtifactCount: upstreamCount,
  };
}

export async function runStrategyPerformanceGate(
  opts: GateRunOptions = {}
): Promise<StrategyPerformanceResult> {
  const getArtifacts = opts.getArtifacts ?? (async () => []);
  const getArtifact = opts.getArtifact ?? (async () => null);

  // Read L1 upstream: last 1 hour of data-freshness artifacts
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const dataFreshnessArtifacts = await getArtifacts("data-freshness", { since });

  // Read latest risk-limits artifact
  const riskLimitArtifact = await getArtifact("risk-limits");
  const riskLimitsArtifacts = riskLimitArtifact ? [riskLimitArtifact.payload] : [];

  const upstreamCount = dataFreshnessArtifacts.length + riskLimitsArtifacts.length;
  const metrics = computeMetrics(upstreamCount);

  const latestDataFreshness =
    dataFreshnessArtifacts.length > 0
      ? String((dataFreshnessArtifacts[0] as Record<string, unknown>)?.status ?? "unknown")
      : null;

  const latestRiskStatus =
    riskLimitsArtifacts.length > 0
      ? String((riskLimitsArtifacts[0] as Record<string, unknown>)?.status ?? "unknown")
      : null;

  const upstreamSummary: StrategyUpstreamSummary = {
    dataFreshness: {
      artifacts: dataFreshnessArtifacts.length,
      latestStatus: latestDataFreshness,
    },
    riskLimits: {
      artifacts: riskLimitsArtifacts.length,
      latestStatus: latestRiskStatus,
    },
  };

  const status = statusFromMetrics(metrics);

  return {
    status,
    reason:
      status === "pass"
        ? undefined
        : [
            metrics.sharpeRatio < 0.5 ? `Sharpe ${metrics.sharpeRatio} < 0.5` : null,
            metrics.maxDrawdownBps > 500 ? `drawdown ${metrics.maxDrawdownBps} bps > 500` : null,
            metrics.winRate < 0.35 ? `win rate ${metrics.winRate} < 0.35` : null,
          ]
            .filter(Boolean)
            .join("; ") || undefined,
    metrics,
    upstreamSummary,
    timestamp: new Date().toISOString(),
  };
}

export const strategyPerformanceGateDefinition: Gate = {
  name: "strategy-performance",
  description: "Daily strategy P&L, Sharpe, win rate, and drawdown (L2)",
  level: 2,
  dependsOn: ["data-freshness", "risk-limits"],
  parallel: true,
  retentionPolicy: STRATEGY_RETENTION,
  run: runStrategyPerformanceGate,
  format: (result) => {
    const row = result as StrategyPerformanceResult;
    const m = row.metrics;
    return [
      `${row.status}: strategy-performance` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ P&L: ${m.dailyPnlBps} bps | Sharpe: ${m.sharpeRatio} | win: ${m.winRate} | DD: ${m.maxDrawdownBps} bps`,
      `       └─ upstream: data-freshness ×${row.upstreamSummary.dataFreshness.artifacts}, risk-limits ×${row.upstreamSummary.riskLimits.artifacts}`,
      `       └─ prune: ${GATE_LEVEL_PRUNE_MS[2] / (24 * 3600 * 1000)} days`,
    ];
  },
};
