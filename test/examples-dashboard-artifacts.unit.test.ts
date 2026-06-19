import { describe, expect, test } from "bun:test";
import { handleArtifactsRequest } from "../examples/dashboard/src/handlers/artifacts.ts";
import { ArtifactStore } from "../src/lib/artifact-store.ts";
import { cleanupPath, testTempDir } from "./helpers.ts";

describe("examples-dashboard-artifacts", () => {
  test("GET /api/artifacts/:gate/lineage returns declarative lineage", async () => {
    const dir = testTempDir("ex-dash-lineage-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await store.save(
        "model-drift",
        { drift: 0.2 },
        { dependsOn: [{ gate: "strategy-performance", limit: 1 }] }
      );

      const res = await handleArtifactsRequest(
        new Request("http://127.0.0.1/api/artifacts/model-drift/lineage")
      );
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        ok: boolean;
        gate: string;
        lineageSource: string;
        dependencyCount: number;
        mermaid: string;
      };
      expect(body.ok).toBe(true);
      expect(body.gate).toBe("model-drift");
      expect(body.lineageSource).toBe("stored");
      expect(body.dependencyCount).toBe(1);
      expect(body.mermaid).toContain("strategy-performance");
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/artifacts?includeLineage=1 embeds lineage summaries", async () => {
    const dir = testTempDir("ex-dash-include-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await store.save(
        "model-drift",
        { drift: 0.2 },
        { dependsOn: [{ gate: "strategy-performance", limit: 1 }] }
      );

      const res = await handleArtifactsRequest(
        new Request("http://127.0.0.1/api/artifacts?includeLineage=1")
      );
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        includeLineage: boolean;
        artifacts: Array<{
          gate: string;
          lineageSource?: string;
          dependencyCount?: number;
        }>;
      };
      expect(body.includeLineage).toBe(true);
      const drift = body.artifacts.find((row) => row.gate === "model-drift");
      expect(drift?.lineageSource).toBe("stored");
      expect(drift?.dependencyCount).toBe(1);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/artifacts/:gate/diff compares artifact paths", async () => {
    const dir = testTempDir("ex-dash-diff-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      const absA = await store.save("model-drift", { drift: 0.1 });
      const absB = await store.save("model-drift", { drift: 0.2 });
      const pathA = store.relativePath(absA);
      const pathB = store.relativePath(absB);
      const res = await handleArtifactsRequest(
        new Request(
          `http://127.0.0.1/api/artifacts/model-drift/diff?a=${encodeURIComponent(pathA)}&b=${encodeURIComponent(pathB)}`
        )
      );
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as { ok: boolean; equal: boolean };
      expect(body.ok).toBe(true);
      expect(body.equal).toBe(false);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/artifacts/metadata returns indexed metadata collection", async () => {
    const dir = testTempDir("ex-dash-metadata-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      await store.save(
        "model-drift",
        { drift: 0.2 },
        {
          dependsOn: [{ gate: "strategy-performance", limit: 1 }],
          runId: "run_test_meta",
          level: 2,
        }
      );

      const res = await handleArtifactsRequest(
        new Request("http://127.0.0.1/api/artifacts/metadata?gate=model-drift&limit=5")
      );
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        ok: boolean;
        indexSource: string;
        entries: Array<{
          gate: string;
          metadata: { runId?: string; level?: number; dependsOn?: unknown[] };
        }>;
      };
      expect(body.ok).toBe(true);
      expect(body.indexSource).toBe("sqlite");
      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.entries[0]?.gate).toBe("model-drift");
      expect(body.entries[0]?.metadata.runId).toBe("run_test_meta");
      expect(body.entries[0]?.metadata.level).toBe(2);
      expect(body.entries[0]?.metadata.dependsOn?.length).toBe(1);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/gates/graph returns execution DAG metadata", async () => {
    const res = await handleArtifactsRequest(new Request("http://127.0.0.1/api/gates/graph"));
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      ok: boolean;
      mermaid: string;
      gates: Array<{ name: string; dependsOn: string[] }>;
    };
    expect(body.ok).toBe(true);
    expect(body.gates.length).toBeGreaterThan(0);
    expect(body.mermaid).toContain("graph");
  });
});
