import { describe, expect, test } from "bun:test";
import {
  ARTIFACT_LINEAGE_CARD_IDS,
  computeRunManifestDiff,
} from "../src/canvases/artifact-lineage.manifest.ts";
import {
  applyCanvasFilter,
  matchesCanvasDeepLink,
  parseCanvasDeepLink,
} from "../src/lib/dashboard-canvas-filter.ts";
import { ARTIFACT_SCHEMA_VERSION } from "../src/lib/artifact-store.ts";
import type { DashboardRunManifestPayload } from "../src/lib/herdr-dashboard-data.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-canvas-filter", () => {
  test("parseCanvasDeepLink reads canvas, identity, and diff params", () => {
    expect(
      parseCanvasDeepLink("?canvas=artifact-lineage&runId=run_a&sessionId=s1&diff=run_a..run_b")
    ).toEqual({
      canvas: "artifact-lineage",
      runId: "run_a",
      sessionId: "s1",
      workspaceId: null,
      paneId: null,
      agentId: null,
      diff: { left: "run_a", right: "run_b" },
    });
  });

  test("matchesCanvasDeepLink uses URLPattern for artifact-lineage", () => {
    expect(
      matchesCanvasDeepLink("http://127.0.0.1:3100/?canvas=artifact-lineage", "artifact-lineage")
    ).toBe(true);
    expect(matchesCanvasDeepLink("?canvas=gate-health", "artifact-lineage")).toBe(false);
  });

  test("applyCanvasFilter highlight-only when canvas has no identity params", async () => {
    const result = await applyCanvasFilter(REPO_ROOT, "?canvas=artifact-lineage");
    expect(result.action?.kind).toBe("highlight");
    if (result.action?.kind === "highlight") {
      expect(result.action.cardIds).toEqual(ARTIFACT_LINEAGE_CARD_IDS);
    }
  });

  test("computeRunManifestDiff compares gate artifact paths", () => {
    const left: DashboardRunManifestPayload = {
      ok: true,
      projectPath: REPO_ROOT,
      runId: "run_a",
      manifest: {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        runId: "run_a",
        startedAt: "",
        completedAt: "",
        gates: ["perf-gate"],
        artifacts: {},
        status: "pass",
      },
      artifacts: [
        {
          gate: "perf-gate",
          path: ".kimi/artifacts/perf-gate/a.json",
          status: "pass",
          summary: "",
          savedAt: null,
        },
      ],
      doctorRuns: [],
      fetchedAt: "",
    };
    const right: DashboardRunManifestPayload = {
      ...left,
      runId: "run_b",
      manifest: left.manifest,
      artifacts: [
        {
          gate: "perf-gate",
          path: ".kimi/artifacts/perf-gate/b.json",
          status: "pass",
          summary: "",
          savedAt: null,
        },
      ],
    };
    const diff = computeRunManifestDiff(left, right);
    expect(diff.gates).toHaveLength(1);
    expect(diff.gates[0]?.match).toBe("diff");
  });
});
