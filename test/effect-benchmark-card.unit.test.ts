import { describe, expect, it } from "bun:test";
import { join } from "path";
import {
  benchmarkFamily,
  buildEffectBenchmarkCardPayload,
  groupMetricsByFamily,
  metricToCardRow,
  readBenchmarkHealthCheck,
  sortedFamilyKeys,
  thresholdSourceKind,
} from "../src/lib/effect-benchmark-card.ts";
import { appendBenchmarkSnapshot } from "../src/lib/effect-benchmark.ts";
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
    const rows = [
      metricToCardRow(sampleMetric({ registryKey: "util.inspect", operation: "inspect" }), {}, "/tmp"),
      metricToCardRow(sampleMetric({ registryKey: "crypto.sha3-256", operation: "sha3-256" }), {}, "/tmp"),
      metricToCardRow(
        sampleMetric({ registryKey: "httpClient.fetch-tls1.2", operation: "fetch-tls1.2" }),
        {},
        "/tmp"
      ),
    ];
    const families = groupMetricsByFamily(rows);
    expect(families.crypto).toHaveLength(1);
    expect(families.httpClient).toHaveLength(1);
    expect(sortedFamilyKeys(families)).toEqual(["crypto", "httpClient", "util"]);
  });

  it("builds dashboard payload with families and layer metadata", () => {
    const metrics = [
      sampleMetric(),
      sampleMetric({
        registryKey: "crypto.sha3-256",
        operation: "sha3-256",
      }),
    ];
    const payload = buildEffectBenchmarkCardPayload(metrics, { pass: true, failures: [] }, "/tmp", {
      thresholdSources: { "crypto.sha256": join("/tmp", "thresholds.baseline.json") },
      snapshotCount: 3,
      lastRunAt: "2026-06-19T12:00:00.000Z",
    });
    expect(payload.registrySize).toBe(2);
    expect(payload.allPass).toBe(true);
    expect(payload.families.crypto).toHaveLength(2);
    expect(payload.metrics[0]!.thresholdSource).toBe("baseline");
    expect(payload.thresholdLayers).toContain("thresholds.baseline.json");
    expect(payload.snapshot.count).toBe(3);
    expect(payload.snapshot.lastRunAt).toBe("2026-06-19T12:00:00.000Z");
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
});