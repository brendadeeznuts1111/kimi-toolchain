/** @description Artifact Portal registration from BenchmarkApiEnvelope. */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import {
  ARTIFACT_PORTAL_GATE,
  PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
  pullBenchmarkEnvelopeAndRegister,
  registerPortalArtifact,
} from "../src/lib/artifact-portal.ts";
import { BENCHMARK_API_SCHEMA_VERSION } from "../src/lib/effect-benchmark-card.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { withTempDir } from "./helpers.ts";

const sampleEnvelope = {
  ok: true,
  schemaVersion: BENCHMARK_API_SCHEMA_VERSION,
  timestamp: "2026-06-20T00:00:00.000Z",
  runner: "serve-probe",
  thresholdSource: "legacy",
  summary: {
    total: 2,
    passing: 2,
    measured: 2,
    skipped: 0,
    partialSuccess: false,
    regressions: 0,
    timedOut: false,
  },
  sparklines: { "crypto.sha256": [0.001] },
  gates: { effectBenchmarkGate: { status: "pass" as const } },
  metadata: {},
  generatedAt: "2026-06-20T00:00:00.000Z",
  allPass: true,
  registrySize: 2,
  measured: 2,
  skipped: 0,
  failures: [],
  families: {},
  metrics: [],
  recentRuns: [],
  thresholdLayers: [],
  snapshot: { count: 0, regressions: 0, regressionKeys: [] },
  philosophy: "",
};

describe("artifact-portal", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("registerPortalArtifact writes artifact-portal gate envelope", async () => {
    await withTempDir("artifact-portal-register", async (dir) => {
      const record = await registerPortalArtifact({
        type: PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
        payload: sampleEnvelope,
        projectRoot: dir,
        canvasId: "benchmark",
        influences: ["card-effect-benchmark"],
      });
      expect(record.canvasId).toBe("benchmark");
      expect(record.type).toBe(PORTAL_BENCHMARK_DIAGNOSTICS_TYPE);
      expect(record.artifactPath).toContain(ARTIFACT_PORTAL_GATE);

      const store = new ArtifactStore(dir);
      const latest = await store.getLatest(ARTIFACT_PORTAL_GATE);
      expect(latest).not.toBeNull();
      const saved = latest!.payload as {
        kind: string;
        type: string;
        canvasId: string;
        payload: { runner: string };
      };
      expect(saved.kind).toBe("artifact-portal-entry");
      expect(saved.type).toBe(PORTAL_BENCHMARK_DIAGNOSTICS_TYPE);
      expect(saved.canvasId).toBe("benchmark");
      expect(saved.payload.runner).toBe("serve-probe");
    });
  });

  test("pullBenchmarkEnvelopeAndRegister fetches probe and registers artifact", async () => {
    await withTempDir("artifact-portal-pull", async (dir) => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(sampleEnvelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;

      const result = await pullBenchmarkEnvelopeAndRegister({
        projectRoot: dir,
        probeUrl: "http://127.0.0.1:59999/api/effect-benchmark",
      });
      expect(result.envelope.runner).toBe("serve-probe");
      expect(result.record.type).toBe(PORTAL_BENCHMARK_DIAGNOSTICS_TYPE);
      expect(result.record.artifactPath).toContain(join(".kimi", "artifacts", ARTIFACT_PORTAL_GATE));
    });
  });
});