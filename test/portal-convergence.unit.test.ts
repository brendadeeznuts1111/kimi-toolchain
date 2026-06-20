/** @description End-to-end Artifact Portal convergence (canvas + dashboard + Herdr → disk). */

import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import {
  ARTIFACT_PORTAL_GATE,
  buildArtifactPortal,
  PORTAL_BENCHMARK_DIAGNOSTICS_TYPE,
  PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE,
} from "../src/lib/artifact-portal.ts";
import {
  buildBenchmarkConvergenceBlock,
  changedTouchesPortalConvergence,
  CONVERGED_PORTAL_COMPONENTS,
  PORTAL_LOCAL_BUILD_BUDGET_MS,
  validatePortalConvergenceGate,
} from "../src/lib/benchmark-convergence.ts";
import { PORTAL_MANIFEST_TYPE } from "../templates/artifact-portal/index.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { BENCHMARK_API_SCHEMA_VERSION } from "../src/lib/effect-benchmark-card.ts";
import { BUN_TEST_CHANGED_IMPORT_GRAPH } from "../src/lib/test-runtime.ts";
import { CONFIG_STATUS_SCHEMA_VERSION } from "../src/lib/config-status.ts";
import { withTempDir } from "./helpers.ts";

const convergence = buildBenchmarkConvergenceBlock("serve-probe", {
  cardCount: 68,
  okCount: 65,
  fetchedAt: "2026-06-20T00:00:00.000Z",
});

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
  metadata: {
    convergence,
    testExecution: { changedImportGraph: BUN_TEST_CHANGED_IMPORT_GRAPH },
  },
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

const configStatusReport = {
  schemaVersion: CONFIG_STATUS_SCHEMA_VERSION,
  tool: "config-status",
  aligned: true,
  gates: [
    { id: "canonical-references", layer: "Discovery", status: "pass" as const, ms: 1 },
    { id: "constants-manifest", layer: "Define registry", status: "pass" as const, ms: 1 },
    { id: "constant-parity", layer: "Cross-repo contract", status: "pass" as const, ms: 1 },
  ],
  fixPlan: [],
};

describe("portal-convergence", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("serve-probe: buildArtifactPortal writes converged benchmark + portal manifest", async () => {
    await withTempDir("portal-convergence", async (dir) => {
      globalThis.fetch = (async (input: string | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/config-status")) {
          return new Response(
            JSON.stringify({
              ok: true,
              configStatus: configStatusReport,
              fetchedAt: new Date().toISOString(),
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }
        return new Response(JSON.stringify(probeEnvelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const result = await buildArtifactPortal({
        projectRoot: dir,
        probeUrl: "http://127.0.0.1:59998/api/effect-benchmark",
        configStatusProbeUrl: "http://127.0.0.1:59998/api/config-status",
      });

      expect(result.ok).toBe(true);
      expect(result.converged).toBe(true);
      expect(result.benchmark.source).toBe("serve-probe");
      expect(result.benchmark.runner).toBe("serve-probe");
      expect(result.configStatus.source).toBe("serve-probe");
      expect(result.configStatus.aligned).toBe(true);
      expect(result.canvasManifestId).toBe("benchmark");
      expect(result.convergedComponents.map((c) => c.id).sort()).toEqual(
        [...CONVERGED_PORTAL_COMPONENTS].sort()
      );
      expect(result.portalIndexPath).toContain(ARTIFACT_PORTAL_GATE);

      const store = new ArtifactStore(dir);
      const entries = await store.listEntries(ARTIFACT_PORTAL_GATE, { limit: 10 });
      expect(entries.total).toBeGreaterThanOrEqual(3);

      let sawBenchmark = false;
      let sawConfigStatus = false;
      let sawManifest = false;
      let manifestPayload:
        | {
            convergedComponents?: { id: string }[];
            configStatus?: { type: string; aligned: boolean };
          }
        | undefined;

      for (const entry of entries.entries) {
        const raw = (await Bun.file(join(dir, entry.path)).json()) as {
          payload?: { type?: string; payload?: unknown };
        };
        const inner = raw.payload;
        if (inner?.type === PORTAL_BENCHMARK_DIAGNOSTICS_TYPE) {
          sawBenchmark = true;
          const diag = inner.payload as {
            metadata?: {
              convergence?: unknown;
              testExecution?: { changedImportGraph?: { title?: string } };
            };
          };
          expect(diag.metadata?.convergence).toBeDefined();
          expect(diag.metadata?.testExecution?.changedImportGraph?.title).toContain("--changed");
        }
        if (inner?.type === PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE) {
          sawConfigStatus = true;
          const diag = inner.payload as { tool?: string; aligned?: boolean };
          expect(diag.tool).toBe("config-status");
          expect(diag.aligned).toBe(true);
        }
        if (inner?.type === PORTAL_MANIFEST_TYPE) {
          sawManifest = true;
          manifestPayload = inner.payload as {
            convergedComponents?: { id: string }[];
            configStatus?: { type: string; aligned: boolean };
          };
        }
      }
      expect(sawBenchmark).toBe(true);
      expect(sawConfigStatus).toBe(true);
      expect(sawManifest).toBe(true);
      expect(manifestPayload?.convergedComponents?.map((c) => c.id).sort()).toEqual(
        [...CONVERGED_PORTAL_COMPONENTS].sort()
      );
      expect(manifestPayload?.configStatus?.type).toBe(PORTAL_CONFIG_STATUS_DIAGNOSTICS_TYPE);
      expect(manifestPayload?.configStatus?.aligned).toBe(true);
    });
  });

  test(
    "local-loop: buildArtifactPortal stamps convergence on local-loop envelope",
    async () => {
      await withTempDir("portal-convergence-local", async (dir) => {
        const started = performance.now();
        const result = await buildArtifactPortal({
          projectRoot: dir,
          preferProbe: false,
        });
        const elapsedMs = performance.now() - started;

        expect(result.ok).toBe(true);
        expect(result.converged).toBe(true);
        expect(result.benchmark.source).toBe("local-loop");
        expect(result.configStatus.source).toBe("local-loop");
        expect(typeof result.configStatus.aligned).toBe("boolean");
        expect(result.configStatus.artifactPath).toContain(ARTIFACT_PORTAL_GATE);
        expect(result.changedImportGraphTitle).toContain("--changed");
        expect(result.convergedComponents).toHaveLength(CONVERGED_PORTAL_COMPONENTS.length);
        expect(elapsedMs).toBeLessThan(PORTAL_LOCAL_BUILD_BUDGET_MS);

        const store = new ArtifactStore(dir);
        const latest = await store.getLatest(ARTIFACT_PORTAL_GATE);
        expect(latest).not.toBeNull();

        const entries = await store.listEntries(ARTIFACT_PORTAL_GATE, { limit: 10 });
        let sawImportGraph = false;
        for (const entry of entries.entries) {
          const raw = (await Bun.file(join(dir, entry.path)).json()) as {
            payload?: {
              type?: string;
              payload?: {
                metadata?: { testExecution?: { changedImportGraph?: { title?: string } } };
              };
            };
          };
          if (raw.payload?.type !== PORTAL_BENCHMARK_DIAGNOSTICS_TYPE) continue;
          expect(raw.payload.payload?.metadata?.testExecution?.changedImportGraph?.title).toContain(
            "--changed"
          );
          sawImportGraph = true;
        }
        expect(sawImportGraph).toBe(true);
      });
    },
    { timeout: PORTAL_LOCAL_BUILD_BUDGET_MS }
  );

  describe("portal convergence gate validation", () => {
    const gateInput = {
      converged: true,
      convergedComponents: CONVERGED_PORTAL_COMPONENTS.map((id) => ({ id })),
      benchmark: { source: "local-loop" as const },
      changedImportGraphTitle: BUN_TEST_CHANGED_IMPORT_GRAPH.title,
    };

    test("validatePortalConvergenceGate passes for fully converged local-loop build", () => {
      const result = validatePortalConvergenceGate(gateInput, {
        requireLocalLoop: true,
        requireImportGraphTitle: true,
      });
      expect(result.ok).toBe(true);
      expect(result.errors).toEqual([]);
    });

    test("validatePortalConvergenceGate rejects missing convergence components", () => {
      const result = validatePortalConvergenceGate(
        {
          ...gateInput,
          converged: false,
          convergedComponents: [{ id: "canvas" }],
        },
        { requireLocalLoop: true, requireImportGraphTitle: true }
      );
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.includes("converged must be true"))).toBe(true);
      expect(result.errors.some((e) => e.includes("convergedComponents"))).toBe(true);
    });

    test("changedTouchesPortalConvergence matches artifact-portal slice paths", () => {
      expect(changedTouchesPortalConvergence(["src/lib/artifact-portal.ts"])).toBe(true);
      expect(changedTouchesPortalConvergence(["README.md"])).toBe(false);
    });
  });
});
