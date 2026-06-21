/**
 * Model Drift Gate (L2 — strategic)
 *
 * Reads strategy-performance artifacts from the last 30 days and
 * computes prediction-accuracy decay.  When drift exceeds thresholds
 * the gate warns or fails, signalling that models need retraining.
 * Part of the trading-domain example in `examples/artifact-trading-loop.md`.
 */
import type { Gate, GateResult, GateRunOptions } from "./types.ts";
import {
  DEFAULT_GATE_ARTIFACT_LIMIT,
  GATE_LEVEL_PRUNE_MS,
  type GateRetentionPolicy,
} from "./types.ts";

const DRIFT_RETENTION: GateRetentionPolicy = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxCount: 30,
};

export interface ModelDriftResult extends GateResult {
  status: "pass" | "warn" | "fail";
  metrics: ModelDriftMetrics;
  upstreamSummary: ModelDriftUpstreamSummary;
  timestamp: string;
}

export interface ModelDriftMetrics {
  /** Mean absolute error between prediction and actual (simulated). */
  mae: number;
  /** Prediction accuracy 0-1 (simulated). */
  accuracy: number;
  /** Drift slope: accuracy change per day over the window. */
  accuracyTrend: number;
  /** Number of strategy-performance artifacts consumed. */
  upstreamArtifactCount: number;
}

export interface ModelDriftUpstreamSummary {
  strategyPerformance: {
    artifacts: number;
    dateRange: { first: string | null; last: string | null };
  };
}

function statusFromDrift(m: ModelDriftMetrics): ModelDriftResult["status"] {
  if (m.accuracy < 0.55 || m.accuracyTrend < -0.02) return "fail";
  if (m.accuracy < 0.7 || m.accuracyTrend < -0.01) return "warn";
  return "pass";
}

/**
 * Simulate model drift metrics.
 *
 * In production this would compare live prediction accuracy against
 * a backtest baseline.  Here we generate values deterministically
 * from the upstream artifact count and day-of-month for reproducibility.
 */
function computeDriftMetrics(upstreamCount: number): ModelDriftMetrics {
  if (upstreamCount < 2) {
    return {
      mae: 0.08,
      accuracy: 0.72,
      accuracyTrend: 0.002,
      upstreamArtifactCount: upstreamCount,
    };
  }

  const seed = (upstreamCount + new Date().getDate()) * 13;
  const pseudo = (offset: number) => {
    const x = Math.sin(seed + offset) * 10000;
    return x - Math.floor(x);
  };

  const accuracy = Math.round(pseudo(1) * 60 + 30) / 100; // 0.30 .. 0.90
  const accuracyTrend = Math.round((pseudo(2) - 0.5) * 40) / 1000; // -0.020 .. +0.020

  return {
    mae: Math.round(pseudo(3) * 300) / 1000, // 0.000 .. 0.300
    accuracy,
    accuracyTrend,
    upstreamArtifactCount: upstreamCount,
  };
}

export async function runModelDriftGate(opts: GateRunOptions = {}): Promise<ModelDriftResult> {
  const getArtifacts = opts.getArtifacts ?? (async () => []);

  // Read last 30 days of strategy-performance artifacts
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const perfArtifacts = await getArtifacts("strategy-performance", {
    since,
    limit: DEFAULT_GATE_ARTIFACT_LIMIT,
  });

  const metrics = computeDriftMetrics(perfArtifacts.length);

  // Derive date range from artifact timestamps when available
  let firstDate: string | null = null;
  let lastDate: string | null = null;
  if (perfArtifacts.length > 0) {
    const timestamps = perfArtifacts
      .map((a) => (a as Record<string, unknown>)?.timestamp as string | undefined)
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .sort();
    firstDate = timestamps[0] ?? null;
    lastDate = timestamps[timestamps.length - 1] ?? null;
  }

  const upstreamSummary: ModelDriftUpstreamSummary = {
    strategyPerformance: {
      artifacts: perfArtifacts.length,
      dateRange: { first: firstDate, last: lastDate },
    },
  };

  const status = statusFromDrift(metrics);

  return {
    status,
    reason:
      status === "pass"
        ? undefined
        : [
            metrics.accuracy < 0.55
              ? `accuracy ${(metrics.accuracy * 100).toFixed(0)}% < 55%`
              : null,
            metrics.accuracyTrend < -0.02
              ? `accuracy trend ${metrics.accuracyTrend.toFixed(3)}/day < -0.02`
              : null,
          ]
            .filter(Boolean)
            .join("; ") || undefined,
    metrics,
    upstreamSummary,
    timestamp: new Date().toISOString(),
  };
}

export const modelDriftGateDefinition: Gate = {
  name: "model-drift",
  description: "Detect prediction accuracy decay from strategy-performance artifacts (L2)",
  level: 2,
  dependsOn: ["strategy-performance"],
  parallel: true,
  retentionPolicy: DRIFT_RETENTION,
  run: runModelDriftGate,
  format: (result) => {
    const row = result as ModelDriftResult;
    const m = row.metrics;
    return [
      `${row.status}: model-drift` + (row.reason ? ` — ${row.reason}` : ""),
      `       └─ accuracy: ${(m.accuracy * 100).toFixed(1)}% | trend: ${m.accuracyTrend.toFixed(3)}/day | MAE: ${m.mae.toFixed(3)}`,
      `       └─ upstream: strategy-performance ×${row.upstreamSummary.strategyPerformance.artifacts}`,
      `       └─ prune: ${GATE_LEVEL_PRUNE_MS[2] / (24 * 3600 * 1000)} days`,
    ];
  },
};
