/** @description Benchmark canvas manifest + serve-probe client helpers. */

import { describe, expect, test } from "bun:test";
import {
  BENCHMARK_CARD_IDS,
  BENCHMARK_MANIFEST_ID,
  benchmarkManifest,
} from "../src/canvases/benchmark.manifest.ts";
import {
  BENCHMARK_PROBE_ROUTE,
  resolveBenchmarkProbeUrl,
} from "../src/lib/benchmark-probe-client.ts";
import { matchesCanvasDeepLink } from "../src/lib/dashboard-canvas-filter.ts";

describe("benchmark-manifest", () => {
  test("manifest id and card ids align with canonical-references", () => {
    expect(BENCHMARK_MANIFEST_ID).toBe("benchmark");
    expect(benchmarkManifest.canvasId).toBe("benchmark");
    expect(BENCHMARK_CARD_IDS).toContain("card-effect-benchmark");
    expect(BENCHMARK_CARD_IDS).toContain("card-bun-test");
    expect(BENCHMARK_CARD_IDS).toHaveLength(4);
  });

  test("URLPattern matches benchmark deep links", () => {
    expect(matchesCanvasDeepLink("?canvas=benchmark", "benchmark")).toBe(true);
    expect(matchesCanvasDeepLink("?canvas=gate-health", "benchmark")).toBe(false);
  });

  test("resolveBenchmarkProbeUrl defaults to serve-probe effect-benchmark route", () => {
    const url = resolveBenchmarkProbeUrl({ host: "127.0.0.1", port: 5678 });
    expect(url).toBe(`http://127.0.0.1:5678${BENCHMARK_PROBE_ROUTE}`);
  });
});
