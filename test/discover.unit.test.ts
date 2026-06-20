import { describe, expect, it } from "bun:test";
import { join } from "path";
import { discoverUnified } from "../src/lib/discover.ts";
import { computeConstantsHealthScore } from "../src/lib/discover-constants.ts";
import { computeDxHealthScore } from "../src/lib/discover-dx-inventory.ts";

describe("discover", () => {
  it("should produce unified report with cross-links and health scores", async () => {
    const root = join(import.meta.dir, "..");
    const report = await discoverUnified(root, { dx: { evaluateProbes: true } });

    expect(report.constants?.constantCount).toBeGreaterThan(20);
    expect(report.dx?.endpointCount).toBe(10);
    expect(report.health.overall).toBeGreaterThan(0);
    expect(report.constants).toBeDefined();
    expect(report.dx).toBeDefined();
    expect(report.health.constants).toBe(report.constants!.healthScore);
    expect(report.health.dx).toBe(report.dx!.healthScore);
    expect(report.crossLinks.length).toBeGreaterThan(0);
    expect(report.unifiedGaps.length).toBeGreaterThan(0);
    expect(report.dx?.liveProbes?.length).toBe(2);
    expect(report.dx?.registeredTomlTables).toContain("endpoints");
    expect(report.dx?.portAlignment.aligned).toBe(true);

    const benchmarkTimeout = report.constants?.constants.find(
      (entry) => entry.key === "KIMI_EFFECT_BENCHMARK_RUN_TIMEOUT_MS"
    );
    expect(benchmarkTimeout?.suggestionMentions.length).toBeGreaterThan(0);
  });

  it("should compute bounded health scores", () => {
    expect(
      computeConstantsHealthScore({
        constantCount: 10,
        invalidCount: 0,
        orphanCount: 0,
        annotationGapCount: 0,
        goldenDriftCount: 0,
        manifestStale: false,
      })
    ).toBe(100);

    expect(
      computeDxHealthScore({
        gaps: [],
        duplicateUrlGroups: 0,
        configuredProbeCount: 2,
        availableProbeCount: 9,
        portAlignment: { aligned: true, notes: [], examplesPorts: [], herdrPorts: [] },
      })
    ).toBeLessThanOrEqual(100);
  });
});
