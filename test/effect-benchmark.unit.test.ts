import { describe, expect, it, beforeEach } from "bun:test";
import { join } from "path";
import {
  appendBenchmarkSnapshot,
  detectBenchmarkRegressions,
  discoverEffectBenchmarks,
  evaluateEffectBenchmarkGate,
  generateBenchmarkHTML,
  readBenchmarkSnapshots,
  registerEffectBenchmark,
  resetEffectBenchmarkRegistry,
  runEffectBenchmarks,
  trainEffectThresholds,
} from "../src/lib/effect-benchmark.ts";
import { withTempDir } from "./helpers.ts";

describe("effect-benchmark", () => {
  beforeEach(() => {
    resetEffectBenchmarkRegistry();
  });

  it("registers and discovers handlers", () => {
    expect(discoverEffectBenchmarks()).toHaveLength(0);
    registerEffectBenchmark({
      registryKey: "demo.op",
      symbol: "kimi.effect.demo",
      thresholdMs: 10,
      workload: () => {},
    });
    expect(discoverEffectBenchmarks()).toHaveLength(1);
    expect(discoverEffectBenchmarks()[0]!.registryKey).toBe("demo.op");
  });

  it("overwrites duplicate registry keys", () => {
    registerEffectBenchmark({
      registryKey: "demo.op",
      symbol: "kimi.effect.demo",
      thresholdMs: 10,
      workload: () => {},
    });
    registerEffectBenchmark({
      registryKey: "demo.op",
      symbol: "kimi.effect.demo",
      thresholdMs: 20,
      workload: () => {},
    });
    expect(discoverEffectBenchmarks()).toHaveLength(1);
    expect(discoverEffectBenchmarks()[0]!.thresholdMs).toBe(20);
  });

  it("runs a benchmark and reports pass/fail", async () => {
    registerEffectBenchmark({
      registryKey: "fast.sleep",
      symbol: "kimi.effect.sleep",
      thresholdMs: 50,
      workload: () => Bun.sleep(1),
    });
    const metrics = await runEffectBenchmarks({ iterations: 3, warmup: 1 });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.registryKey).toBe("fast.sleep");
    expect(metrics[0]!.pass).toBe(true);
    expect(metrics[0]!.actualMs).toBeGreaterThan(0);
  });

  it("carries registry source metadata into metrics", async () => {
    registerEffectBenchmark({
      registryKey: "source.demo",
      symbol: "kimi.effect.source",
      thresholdMs: 50,
      sourceFile: "src/lib/source-demo.ts",
      lineNumber: 12,
      sourceDescription: "demo workload",
      workload: () => {},
    });
    const metrics = await runEffectBenchmarks({ iterations: 1, warmup: 0 });
    expect(metrics[0]!.sourceFile).toBe("src/lib/source-demo.ts");
    expect(metrics[0]!.lineNumber).toBe(12);
    expect(metrics[0]!.sourceDescription).toBe("demo workload");
  });

  it("filters by registryKeys", async () => {
    registerEffectBenchmark({ registryKey: "a.a", symbol: "s", workload: () => {} });
    registerEffectBenchmark({ registryKey: "b.b", symbol: "s", workload: () => {} });
    const metrics = await runEffectBenchmarks({ registryKeys: ["a.a"] });
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.registryKey).toBe("a.a");
  });

  it("skips benchmarks when skipIf returns true", async () => {
    registerEffectBenchmark({
      registryKey: "skip.me",
      symbol: "kimi.effect.skip",
      workload: () => {
        throw new Error("should not run");
      },
      skipIf: () => true,
      skipReason: "unavailable",
    });
    const metrics = await runEffectBenchmarks();
    expect(metrics[0]!.skipped).toBe(true);
    expect(metrics[0]!.pass).toBe(true);
  });

  it("trains thresholds when all pass", async () => {
    registerEffectBenchmark({
      registryKey: "trainable",
      symbol: "kimi.effect.train",
      thresholdMs: 100,
      workload: () => Bun.sleep(2),
    });
    const metrics = await runEffectBenchmarks({ iterations: 3, warmup: 1 });
    const result = await withTempDir("effect-benchmark-train", async (dir) => {
      return trainEffectThresholds(metrics, dir, 1.2);
    });
    expect(result.written).toBe(true);
    expect(result.thresholds["trainable"]!).toBeGreaterThan(0);
  });

  it("refuses to train when a metric fails", async () => {
    registerEffectBenchmark({
      registryKey: "failing",
      symbol: "kimi.effect.fail",
      thresholdMs: 0.001,
      workload: () => Bun.sleep(2),
    });
    const metrics = await runEffectBenchmarks({ iterations: 1, warmup: 0 });
    const result = await trainEffectThresholds(metrics);
    expect(result.written).toBe(false);
  });

  it("gates against trained thresholds", async () => {
    registerEffectBenchmark({
      registryKey: "gated",
      symbol: "kimi.effect.gate",
      thresholdMs: 100,
      workload: () => Bun.sleep(2),
    });
    const metrics = await runEffectBenchmarks({ iterations: 3, warmup: 1 });
    await withTempDir("effect-benchmark-gate", async (dir) => {
      await trainEffectThresholds(metrics, dir, 1.0);
      const gate = await evaluateEffectBenchmarkGate(metrics, join(dir, "thresholds.json"));
      expect(gate.pass).toBe(true);
    });
  });

  it("formats gate failures with per-source context", async () => {
    await withTempDir("effect-benchmark-source-gate", async (dir) => {
      const thresholdsPath = join(dir, "thresholds.json");
      await Bun.write(thresholdsPath, JSON.stringify({ "source.fail": 1 }));
      const gate = await evaluateEffectBenchmarkGate(
        [
          {
            registryKey: "source.fail",
            symbol: "kimi.effect.source",
            operation: "fail",
            actualMs: 2,
            thresholdMs: 10,
            pass: false,
            sourceFile: "src/lib/source-demo.ts",
            lineNumber: 12,
            sourceDescription: "demo workload",
          },
        ],
        thresholdsPath
      );
      expect(gate.pass).toBe(false);
      expect(gate.failures[0]).toContain("fail: source.fail exceeded threshold (2ms > 1ms)");
      expect(gate.failures[0]).toContain("source: src/lib/source-demo.ts:12 (demo workload)");
      expect(gate.failures[0]).toContain(`threshold: 1ms (set in ${thresholdsPath})`);
      expect(gate.failures[0]).toContain("last trained:");
    });
  });

  it("detects regressions beyond tolerance", () => {
    const previous = [
      {
        symbol: "s",
        operation: "op",
        actualMs: 1.0,
        thresholdMs: 10,
        pass: true,
        registryKey: "k",
      },
    ];
    const current = [
      {
        symbol: "s",
        operation: "op",
        actualMs: 1.2,
        thresholdMs: 10,
        pass: true,
        registryKey: "k",
      },
    ];
    const regressions = detectBenchmarkRegressions(current, previous, 1.05);
    // delta is only 0.2ms, below MIN_REGRESSION_DELTA_MS of 0.1? Actually 0.2 > 0.1, so regression flagged.
    expect(regressions).toHaveLength(1);
  });

  it("ignores noise below min regression delta", () => {
    const previous = [
      {
        symbol: "s",
        operation: "op",
        actualMs: 0.01,
        thresholdMs: 10,
        pass: true,
        registryKey: "k",
      },
    ];
    const current = [
      {
        symbol: "s",
        operation: "op",
        actualMs: 0.02,
        thresholdMs: 10,
        pass: true,
        registryKey: "k",
      },
    ];
    const regressions = detectBenchmarkRegressions(current, previous, 1.05);
    expect(regressions).toHaveLength(0);
  });

  it("appends and reads snapshots", async () => {
    await withTempDir("effect-benchmark-snap", async (dir) => {
      const metrics = [
        {
          symbol: "s",
          operation: "op",
          actualMs: 1,
          thresholdMs: 10,
          pass: true,
          registryKey: "k",
        },
      ];
      const snapshot = await appendBenchmarkSnapshot(dir, metrics, { gitHead: "abc123" });
      expect(snapshot.metrics).toEqual(metrics);
      expect(snapshot.gitHead).toBe("abc123");
      const loaded = await readBenchmarkSnapshots(dir, 5);
      expect(loaded).toHaveLength(1);
    });
  });

  it("generates HTML report with metadata", () => {
    const metrics = [
      {
        symbol: "s",
        operation: "op",
        actualMs: 1.234,
        thresholdMs: 10,
        pass: true,
        registryKey: "k",
      },
    ];
    const html = generateBenchmarkHTML(metrics, {
      title: "Test Report",
      meta: { generatedAt: "2026-01-01T00:00:00Z", regressionCount: 0, snapshotCount: 3 },
    });
    expect(html).toContain("Test Report");
    expect(html).toContain("k");
    expect(html).toContain("1.234");
    expect(html).toContain("History snapshots: 3");
  });
});
