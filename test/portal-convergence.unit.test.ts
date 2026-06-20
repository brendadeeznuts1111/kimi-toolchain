/** @description End-to-end Artifact Portal convergence smoke (canvas → envelope → disk). */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import {
  ARTIFACT_PORTAL_GATE,
  buildArtifactPortal,
  PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
} from "../src/lib/artifact-portal.ts";
import { PORTAL_MANIFEST_TYPE } from "../templates/artifact-portal/index.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { BENCHMARK_API_SCHEMA_VERSION } from "../src/lib/effect-benchmark-card.ts";
import { withTempDir } from "./helpers.ts";

const probeEnvelope = {
  ok: true,
  schemaVersion: BENCHMARK_API_SCHEMA_VERSION,
  timestamp: "2026-06-20T00:00:00.000Z",
  runner: "serve-probe",
  thresholdSource: "legacy",
  summary: {
    total: 1,
    passing: 1,
    measured: 1,
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
  registrySize: 1,
  measured: 1,
  skipped: 0,
  failures: [],
  families: {},
  metrics: [],
  recentRuns: [],
  thresholdLayers: [],
  snapshot: { count: 0, regressions: 0, regressionKeys: [] },
  philosophy: "",
};

describe("portal-convergence", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("buildArtifactPortal writes benchmark + portal manifest artifacts", async () => {
    await withTempDir("portal-convergence", async (dir) => {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify(probeEnvelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof fetch;

      const result = await buildArtifactPortal({
        projectRoot: dir,
        probeUrl: "http://127.0.0.1:59998/api/effect-benchmark",
      });

      expect(result.ok).toBe(true);
      expect(result.benchmark.source).toBe("serve-probe");
      expect(result.benchmark.runner).toBe("serve-probe");
      expect(result.canvasManifestId).toBe("benchmark");
      expect(result.portalIndexPath).toContain(ARTIFACT_PORTAL_GATE);

      const store = new ArtifactStore(dir);
      const entries = await store.listEntries(ARTIFACT_PORTAL_GATE, { limit: 10 });
      expect(entries.total).toBeGreaterThanOrEqual(2);

      let sawBenchmark = false;
      let sawManifest = false;
      for (const entry of entries.entries) {
        const raw = (await Bun.file(join(dir, entry.path)).json()) as {
          payload?: { type?: string };
        };
        if (raw.payload?.type === PORTAL_BENCHMARK_DIAGNOSTICS_TYPE) sawBenchmark = true;
        if (raw.payload?.type === PORTAL_MANIFEST_TYPE) sawManifest = true;
      }
      expect(sawBenchmark).toBe(true);
      expect(sawManifest).toBe(true);
    });
  });
});