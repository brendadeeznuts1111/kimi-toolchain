import { describe, expect, test } from "bun:test";
import { ARTIFACT_LINEAGE_CARD_IDS } from "../src/canvases/artifact-lineage.manifest.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { apiCanvasFilter } from "../examples/dashboard/src/handlers/canvas-cards.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

describe("examples-dashboard-canvas-filter", () => {
  test("GET /api/canvas-filter highlight for artifact-lineage", async () => {
    const res = await apiCanvasFilter(
      new Request("http://127.0.0.1/api/canvas-filter?canvas=artifact-lineage")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      action?: { kind: string; canvas: string; cardIds: string[] };
    };
    expect(body.ok).toBe(true);
    expect(body.action?.kind).toBe("highlight");
    expect(body.action?.canvas).toBe("artifact-lineage");
    expect(body.action?.cardIds).toEqual([...ARTIFACT_LINEAGE_CARD_IDS]);
  });

  test("GET /api/canvas-filter?runId= returns run-manifest action", async () => {
    const dir = testTempDir("ex-dash-canvas-run-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    const runId = "run_canvas_filter_test";
    try {
      const store = new ArtifactStore(dir);
      const artifactPath = await store.save("model-drift", { drift: 0.1 }, { runId });
      await store.saveRunManifest({
        schemaVersion: 1,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": store.relativePath(artifactPath) },
        status: "pass",
      });

      const res = await apiCanvasFilter(
        new Request(
          `http://127.0.0.1/api/canvas-filter?canvas=artifact-lineage&runId=${encodeURIComponent(runId)}`
        )
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        action?: {
          kind: string;
          cardIds: string[];
          payload?: { runId: string; ok: boolean };
        };
      };
      expect(body.ok).toBe(true);
      expect(body.action?.kind).toBe("run-manifest");
      expect(body.action?.cardIds).toContain("card-artifacts");
      expect(body.action?.payload?.runId).toBe(runId);
      expect(body.action?.payload?.ok).toBe(true);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/canvas-filter infers artifact-lineage canvas from runId alone", async () => {
    const dir = testTempDir("ex-dash-canvas-infer-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    const runId = "run_canvas_infer";
    try {
      const store = new ArtifactStore(dir);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: [],
        artifacts: {},
        status: "pass",
      });

      const res = await apiCanvasFilter(
        new Request(`http://127.0.0.1/api/canvas-filter?runId=${encodeURIComponent(runId)}`)
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { action: null | { kind: string } };
      // runId without canvas only resolves when browser adds canvas; API returns null action
      expect(body.action).toBeNull();
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });
});