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
      const upstreamPath = await store.save("strategy-performance", { pnl: 1 });
      await store.save(
        "model-drift",
        { drift: 0.2 },
        {
          dependsOn: [{ gate: "strategy-performance", limit: 1 }],
          runId: "run_test_meta",
          level: 2,
          lineage: {
            dependencies: ["strategy-performance"],
            upstreamArtifacts: [store.relativePath(upstreamPath)],
          },
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
          metadata: {
            runId?: string;
            level?: number;
            dependsOn?: unknown[];
            hostname?: string;
            pid?: number;
            lineage?: { upstreamArtifacts: string[] };
          };
        }>;
      };
      expect(body.ok).toBe(true);
      expect(body.indexSource).toBe("sqlite");
      expect(body.entries.length).toBeGreaterThan(0);
      expect(body.entries[0]?.gate).toBe("model-drift");
      expect(body.entries[0]?.metadata.runId).toBe("run_test_meta");
      expect(body.entries[0]?.metadata.level).toBe(2);
      expect(body.entries[0]?.metadata.dependsOn?.length).toBe(1);
      expect(body.entries[0]?.metadata.hostname).toBeTruthy();
      expect(body.entries[0]?.metadata.pid).toBe(process.pid);
      expect(body.entries[0]?.metadata.lineage?.upstreamArtifacts?.length).toBe(1);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/runs lists saved run manifests via fetchDashboardRunsList SSOT", async () => {
    const dir = testTempDir("ex-dash-runs-list-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      const runId = "run_dashboard_list";
      await store.saveRunManifest({
        schemaVersion: 1,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: {},
        status: "pass",
        sessionId: "sess_list",
      });

      const res = await handleArtifactsRequest(new Request("http://127.0.0.1/api/runs"));
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        ok: boolean;
        runs: Array<{ runId: string; sessionId?: string }>;
      };
      expect(body.ok).toBe(true);
      expect(body.runs.some((row) => row.runId === runId)).toBe(true);
      expect(body.runs.find((row) => row.runId === runId)?.sessionId).toBe("sess_list");
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/runs/:runId returns provenance metadata on artifacts", async () => {
    const dir = testTempDir("ex-dash-run-meta-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      const runId = "run_dashboard_meta";
      const artifactPath = await store.save(
        "model-drift",
        { drift: 0.2 },
        {
          runId,
          dependsOn: [{ gate: "strategy-performance", limit: 1 }],
          lineage: { dependencies: ["strategy-performance"], upstreamArtifacts: [] },
        }
      );
      const relativePath = store.relativePath(artifactPath);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": relativePath },
        status: "pass",
      });

      const res = await handleArtifactsRequest(new Request(`http://127.0.0.1/api/runs/${runId}`));
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        ok: boolean;
        artifacts: Array<{
          gate: string;
          hostname?: string;
          pid?: number;
          dependsOn?: unknown[];
          lineage?: { dependencies: string[] };
        }>;
      };
      expect(body.ok).toBe(true);
      expect(body.artifacts[0]?.gate).toBe("model-drift");
      expect(body.artifacts[0]?.hostname).toBeTruthy();
      expect(body.artifacts[0]?.pid).toBe(process.pid);
      expect(body.artifacts[0]?.dependsOn?.length).toBe(1);
      expect(body.artifacts[0]?.lineage?.dependencies).toEqual(["strategy-performance"]);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/artifacts/context includes declarative dependsOn edges", async () => {
    const dir = testTempDir("ex-dash-context-deps-");
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
        new Request("http://127.0.0.1/api/artifacts/context")
      );
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        ok: boolean;
        edges: Array<{ from: string; to: string }>;
        nodes: Array<{ gate: string; dependsOn?: unknown[]; hostname?: string; pid?: number }>;
      };
      expect(body.ok).toBe(true);
      expect(body.edges.length).toBeGreaterThan(0);
      const drift = body.nodes.find((node) => node.gate === "model-drift");
      expect(drift?.dependsOn?.length).toBe(1);
      expect(drift?.hostname).toBeTruthy();
      expect(drift?.pid).toBe(process.pid);
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

  test("GET /api/artifacts exposes count and gates aliases", async () => {
    const dir = testTempDir("ex-dash-count-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await store.save("model-drift", { drift: 0.2 });

      const res = await handleArtifactsRequest(new Request("http://127.0.0.1/api/artifacts"));
      expect(res?.status).toBe(200);
      const body = (await res!.json()) as {
        count: number;
        gates: string[];
        artifacts: Array<{ gate: string }>;
      };
      expect(body.count).toBe(2);
      expect(body.gates.sort()).toEqual(["model-drift", "strategy-performance"]);
      expect(body.artifacts.map((row) => row.gate).sort()).toEqual(body.gates.sort());
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });

  test("GET /api/sessions and scoped session routes filter artifacts and runs", async () => {
    const dir = testTempDir("ex-dash-sessions-");
    const prev = Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
    Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = dir;
    try {
      const store = new ArtifactStore(dir);
      await store.save("model-drift", { drift: 0.1 }, { workspaceId: "herdr_scope_a" });
      await store.save("model-drift", { drift: 0.2 }, { workspaceId: "herdr_scope_b" });
      await store.saveRunManifest({
        schemaVersion: 1,
        runId: "run_scope_a",
        status: "pass",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: {},
        workspaceId: "herdr_scope_a",
      });

      const indexRes = await handleArtifactsRequest(new Request("http://127.0.0.1/api/sessions"));
      expect(indexRes?.status).toBe(200);
      const indexBody = (await indexRes!.json()) as {
        sessions: { kimi: string[]; herdr: string[] };
      };
      expect(indexBody.sessions.herdr).toContain("herdr_scope_a");
      expect(indexBody.sessions.herdr).toContain("herdr_scope_b");

      const artifactsRes = await handleArtifactsRequest(
        new Request("http://127.0.0.1/api/sessions/herdr_scope_a/artifacts")
      );
      expect(artifactsRes?.status).toBe(200);
      const artifactsBody = (await artifactsRes!.json()) as {
        artifacts: Array<{ workspaceId?: string }>;
        filter: { workspaceId?: string };
      };
      expect(artifactsBody.filter.workspaceId).toBe("herdr_scope_a");
      expect(artifactsBody.artifacts.every((row) => row.workspaceId === "herdr_scope_a")).toBe(
        true
      );

      const runsRes = await handleArtifactsRequest(
        new Request("http://127.0.0.1/api/sessions/herdr_scope_a/runs")
      );
      expect(runsRes?.status).toBe(200);
      const runsBody = (await runsRes!.json()) as {
        runs: Array<{ runId: string; workspaceId?: string }>;
      };
      expect(runsBody.runs.some((row) => row.runId === "run_scope_a")).toBe(true);
      expect(runsBody.runs.every((row) => row.workspaceId === "herdr_scope_a")).toBe(true);
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_ARTIFACT_PROJECT_ROOT;
      else Bun.env.KIMI_ARTIFACT_PROJECT_ROOT = prev;
      cleanupPath(dir);
    }
  });
});
