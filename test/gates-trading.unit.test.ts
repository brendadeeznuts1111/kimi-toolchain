import { describe, expect, test } from "bun:test";
import { runModelDriftGate } from "../src/gates/model-drift.ts";
import { runGatesWithDependencies } from "../src/gates/runner.ts";
import { resolveGateClosure } from "../src/gates/registry.ts";
import { runStrategyPerformanceGate } from "../src/gates/strategy-performance.ts";
import { computeNormalizedDrift, readPerformanceValue } from "../src/gates/trading-metrics.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { testTempDir, cleanupPath } from "./helpers.ts";

describe("gates-trading sample gates", () => {
  test("readPerformanceValue accepts returns, pnl, and metrics", () => {
    expect(readPerformanceValue({ returns: 0.42 })).toBe(0.42);
    expect(readPerformanceValue({ pnl: 3 })).toBe(3);
    expect(readPerformanceValue({ metrics: { sharpeRatio: 1.8 } })).toBe(1.8);
    expect(readPerformanceValue({ status: "pass" })).toBeNull();
  });

  test("computeNormalizedDrift increases with spread", () => {
    expect(computeNormalizedDrift([1, 1, 1])).toBe(0);
    expect(computeNormalizedDrift([1, 2])).toBeGreaterThan(0);
  });

  test("runStrategyPerformanceGate produces metrics snapshot", async () => {
    const result = await runStrategyPerformanceGate();
    expect(["pass", "warn", "fail"]).toContain(result.status);
    expect(result.metrics.sharpeRatio).toBeGreaterThanOrEqual(0);
    expect(result.metrics.upstreamArtifactCount).toBeGreaterThanOrEqual(0);
  });

  test("runModelDriftGate passes with thin upstream history (demo baseline)", async () => {
    const result = await runModelDriftGate({
      getArtifacts: async () => [{ timestamp: new Date().toISOString() }],
    });
    expect(result.status).toBe("pass");
    expect(result.metrics.upstreamArtifactCount).toBe(1);
  });

  test("runModelDriftGate passes with strategy-performance history", async () => {
    const history = Array.from({ length: 5 }, (_, index) => ({
      timestamp: new Date(Date.now() - index * 86_400_000).toISOString(),
      metrics: { sharpeRatio: 1.5 },
    }));
    const result = await runModelDriftGate({ getArtifacts: async () => history });
    expect(["pass", "warn"]).toContain(result.status);
    expect(result.metrics.upstreamArtifactCount).toBe(5);
  });

  test("model-drift closure runs strategy-performance → model-drift with lineage", async () => {
    const dir = testTempDir("gates-trading-loop-");
    const store = new ArtifactStore(dir);
    await store.save("strategy-performance", {
      metrics: { sharpeRatio: 1.2, dailyPnlBps: 40, winRate: 0.55, maxDrawdownBps: 100 },
      timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await store.save("strategy-performance", {
      metrics: { sharpeRatio: 1.25, dailyPnlBps: 45, winRate: 0.56, maxDrawdownBps: 110 },
      timestamp: new Date().toISOString(),
    });

    const { gates, missing } = resolveGateClosure("model-drift");
    expect(missing).toEqual([]);
    expect(gates.map((g) => g.name)).toEqual(["strategy-performance", "model-drift"]);

    const outcome = await runGatesWithDependencies(gates, {
      projectRoot: dir,
      saveArtifact: true,
    });
    expect(outcome.results.map((r) => r.gate)).toEqual(["strategy-performance", "model-drift"]);
    expect(outcome.results[0]?.status).toBe("pass");
    // model-drift uses day-of-month in its deterministic seed — status varies by calendar day
    expect(["pass", "warn", "fail"]).toContain(outcome.results[1]?.status);

    const drift = await store.getLatest("model-drift");
    expect(drift?.payload).toBeTruthy();
    const graph = await store.buildLineageGraph(drift!.relativePath);
    expect(graph?.mermaid).toContain("strategy-performance");

    cleanupPath(dir);
  });
});
