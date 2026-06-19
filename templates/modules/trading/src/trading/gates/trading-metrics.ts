/** Shared metric helpers for L2 trading sample gates (strategy-performance, model-drift). */

export function readPerformanceValue(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.returns === "number" && Number.isFinite(row.returns)) return row.returns;
  if (typeof row.pnl === "number" && Number.isFinite(row.pnl)) return row.pnl;
  const metrics = row.metrics;
  if (metrics && typeof metrics === "object") {
    const m = metrics as Record<string, unknown>;
    if (typeof m.sharpeRatio === "number" && Number.isFinite(m.sharpeRatio)) {
      return m.sharpeRatio;
    }
    if (typeof m.dailyPnlBps === "number" && Number.isFinite(m.dailyPnlBps)) {
      return m.dailyPnlBps / 100;
    }
  }
  return null;
}

/** Normalized drift in [0, 1] from a performance history (0 = stable). */
export function computeNormalizedDrift(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) {
    const spread = Math.max(...values) - Math.min(...values);
    return Math.min(1, spread);
  }
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const stddev = Math.sqrt(variance);
  return Math.min(1, stddev / Math.abs(mean));
}
