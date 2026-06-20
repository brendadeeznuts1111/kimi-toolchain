import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  benchmarkFamily,
  buildBenchmarkApiEnvelope,
  buildEffectBenchmarkCardPayload,
  buildRecentRunsSummary,
  buildSparklines,
  enrichCardRows,
  groupMetricsByFamily,
  mapBenchmarkTaxonomyErrors,
  readBenchmarkHealthCheck,
  resolveThresholdSourceLabel,
  rowRegression,
  sortedFamilyKeys,
  thresholdSourceKind,
} from "../src/lib/effect-benchmark-card.ts";
import { appendBenchmarkSnapshot, type EffectBenchmarkSnapshot } from "../src/lib/effect-benchmark.ts";
import {
  thresholdsBaselinePath,
  thresholdsLegacyPath,
  thresholdsLocalPath,
} from "../src/lib/paths.ts";
import type { Metric } from "../src/harness/html-reporter.ts";
import { withTempDir } from "./helpers.ts";

const sampleMetric = (overrides: Partial<Metric> = {}): Metric => ({
  symbol: "kimi.effect.crypto",
  operation: "sha256",
  actualMs: 0.01,
  thresholdMs: 0.01,
  pass: true,
  registryKey: "crypto.sha256",
  ...overrides,
});

function snapshotAt(
  generatedAt: string,
  metrics: Metric[],
  overrides: Partial<EffectBenchmarkSnapshot> = {}
): EffectBenchmarkSnapshot {
  return {
    schemaVersion: 1,
    tool: "test",
    generatedAt,
    project: "test",
    metrics,
    ...overrides,
  };
}

describe("effect-benchmark-card", () => {
  it("derives benchmark families from registry keys", () => {
    expect(benchmarkFamily("crypto.sha3-256")).toBe("crypto");
    expect(benchmarkFamily("httpClient.fetch-tls1.2")).toBe("httpClient");
    expect(benchmarkFamily("clock")).toBe("clock");
  });

  it("resolves threshold source kinds from layer paths", async () => {
    await withTempDir("benchmark-card-source", async (dir) => {
      const sources = {
        "crypto.sha256": thresholdsBaselinePath(dir),
        "httpClient.fetch-tls1.2": thresholdsLocalPath(dir),
        legacy: thresholdsLegacyPath(dir),
      };
      expect(thresholdSourceKind("crypto.sha256", sources, dir)).toBe("baseline");
      expect(thresholdSourceKind("httpClient.fetch-tls1.2", sources, dir)).toBe("local");
      expect(thresholdSourceKind("legacy", sources, dir)).toBe("legacy");
      expect(thresholdSourceKind("uuid", sources, dir)).toBe("default");
    });
  });

  it("groups metrics by family and sorts keys for display", () => {
    const rows = enrichCardRows(
      [
        sampleMetric({ registryKey: "util.inspect", operation: "inspect" }),
        sampleMetric({ registryKey: "crypto.sha3-256", operation: "sha3-256" }),
        sampleMetric({
          registryKey: "httpClient.fetch-tls1.2",
          operation: "fetch-tls1.2",
        }),
      ],
      {},
      "/tmp"
    );
    const families = groupMetricsByFamily(rows);
    expect(families.crypto).toHaveLength(1);
    expect(families.httpClient).toHaveLength(1);
    expect(sortedFamilyKeys(families)).toEqual(["crypto", "httpClient", "util"]);
  });

  it("builds sparklines oldest to newest from NDJSON history", () => {
    const snapshots = [
      snapshotAt("2026-06-19T03:00:00Z", [sampleMetric({ actualMs: 0.03 })]),
      snapshotAt("2026-06-19T02:00:00Z", [sampleMetric({ actualMs: 0.02 })]),
      snapshotAt("2026-06-19T01:00:00Z", [sampleMetric({ actualMs: 0.01 })]),
    ];
    const sparklines = buildSparklines(snapshots, ["crypto.sha256"], 3);
    expect(sparklines["crypto.sha256"]).toEqual([0.01, 0.02, 0.03]);
  });

  it("flags per-row regression when latency exceeds tolerance", () => {
    const current = sampleMetric({ actualMs: 0.5 });
    const previous = [sampleMetric({ actualMs: 0.01 })];
    const regression = rowRegression(current, previous);
    expect(regression?.regressed).toBe(true);
    expect(regression?.previousMs).toBe(0.01);
    expect(regression?.deltaMs).toBeGreaterThan(0);
  });

  it("builds dashboard payload with sparklines, regressions, and recent runs", () => {
    const metrics = [
      sampleMetric({ actualMs: 0.5 }),
      sampleMetric({
        registryKey: "crypto.sha3-256",
        operation: "sha3-256",
        actualMs: 0.012,
      }),
    ];
    const history = [
      snapshotAt("2026-06-19T12:00:00Z", metrics),
      snapshotAt("2026-06-19T11:00:00Z", [sampleMetric({ actualMs: 0.01 })]),
      snapshotAt("2026-06-19T10:00:00Z", [sampleMetric({ actualMs: 0.009 })]),
    ];

    const payload = buildEffectBenchmarkCardPayload(metrics, { pass: true, failures: [] }, "/tmp", {
      thresholdSources: { "crypto.sha256": join("/tmp", "thresholds.baseline.json") },
      historySnapshots: history,
      previousSnapshot: history[1],
      snapshotCount: history.length,
      lastRunAt: history[0]!.generatedAt,
    });

    expect(payload.registrySize).toBe(2);
    expect(payload.recentRuns).toHaveLength(3);
    expect(payload.metrics[0]!.sparkline).toEqual([0.009, 0.01, 0.5]);
    expect(payload.metrics[0]!.regression?.regressed).toBe(true);
    expect(payload.snapshot.regressionKeys).toContain("crypto.sha256");
    expect(payload.families.crypto).toHaveLength(2);
  });

  it("summarizes recent runs with pass counts", () => {
    const runs = buildRecentRunsSummary([
      snapshotAt("t2", [sampleMetric(), sampleMetric({ pass: false, actualMs: 5 })]),
      snapshotAt("t1", [sampleMetric()]),
    ]);
    expect(runs[0]!.measured).toBe(2);
    expect(runs[0]!.passed).toBe(1);
    expect(runs[0]!.allPass).toBe(false);
    expect(runs[1]!.allPass).toBe(true);
  });

  it("reads health from latest snapshot without running benchmarks", async () => {
    await withTempDir("benchmark-card-health", async (dir) => {
      const unknown = await readBenchmarkHealthCheck(dir);
      expect(unknown.status).toBe("unknown");
      expect(unknown.pass).toBeNull();

      await appendBenchmarkSnapshot(dir, [
        sampleMetric(),
        sampleMetric({
          registryKey: "crypto.sha3-256",
          operation: "sha3-256",
          pass: false,
          actualMs: 5,
          thresholdMs: 0.01,
        }),
      ]);

      const health = await readBenchmarkHealthCheck(dir);
      expect(health.status).toBe("error");
      expect(health.pass).toBe(false);
      expect(health.measured).toBe(2);
      expect(health.failures).toBe(1);
      expect(health.lastRunAt).toBeDefined();
    });
  });

  it("maps benchmark issues to taxonomy error types", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric({ actualMs: 5, pass: false })],
      { pass: false, failures: ["fail: crypto.sha256 exceeded threshold"] },
      "/tmp",
      { partialSuccess: true, timedOut: true, errors: [{ registryKey: "x", message: "boom" }] }
    );
    const taxonomy = mapBenchmarkTaxonomyErrors(payload, payload.errors);
    expect(taxonomy.some((t) => t.type === "perf_gate_timeout")).toBe(true);
    expect(taxonomy.some((t) => t.type === "perf_gate_partial")).toBe(true);
    expect(taxonomy.some((t) => t.type === "perf_handler_failure")).toBe(true);
  });

  it("builds API envelope with summary, sparklines, and gates", () => {
    const payload = buildEffectBenchmarkCardPayload(
      [sampleMetric()],
      { pass: true, failures: [] },
      "/tmp",
      {
        thresholdSources: {
          "crypto.sha256": thresholdsBaselinePath("/tmp"),
        },
      }
    );
    const envelope = buildBenchmarkApiEnvelope(payload, {
      runner: "kimi-doctor",
      thresholdSource: resolveThresholdSourceLabel(
        { "crypto.sha256": thresholdsBaselinePath("/tmp") },
        "/tmp"
      ),
      gate: { pass: true, failures: [] },
      mapTaxonomy: true,
    });
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.runner).toBe("kimi-doctor");
    expect(envelope.summary.total).toBe(1);
    expect(envelope.gates.effectBenchmarkGate.status).toBe("pass");
    expect(envelope.sparklines["crypto.sha256"]).toBeDefined();
  });

  it("marks health warn when latest run passes but regressed vs previous", async () => {
    await withTempDir("benchmark-card-health-warn", async (dir) => {
      await appendBenchmarkSnapshot(dir, [sampleMetric({ actualMs: 0.01 })]);
      await appendBenchmarkSnapshot(dir, [sampleMetric({ actualMs: 0.5 })]);

      const health = await readBenchmarkHealthCheck(dir);
      expect(health.pass).toBe(true);
      expect(health.status).toBe("warn");
      expect(health.regressions).toBeGreaterThan(0);
      expect(health.regressionKeys).toContain("crypto.sha256");
    });
  });
});