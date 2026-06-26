import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, pathExists } from "../src/lib/bun-io.ts";
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactStore,
  artifactIdentityEnv,
  artifactScopeKey,
  computeArtifactContentHash,
  extractArtifactTimestamp,
  extractArtifactTimestampMs,
  artifactFilterFromSessionRoute,
  generateRunId,
  matchesArtifactSessionContext,
  normalizeArtifactIdentityValue,
  normalizeArtifactSessionContext,
  resolveArtifactSessionContext,
} from "../src/lib/artifact-store.ts";
import type { ArtifactRunManifest } from "../src/lib/artifact-store.ts";
import { withTempDir } from "./helpers.ts";

describe("artifact-store", () => {
  test("save writes JSON under .kimi/artifacts/{gateName}/", async () => {
    await withTempDir("artifact-store-", async (dir) => {
      const store = new ArtifactStore(dir);
      const path = await store.save("bunfig-policy", { status: "pass", ok: true });

      expect(path).toContain(join(dir, ".kimi", "artifacts", "bunfig-policy"));
      expect(pathExists(path)).toBe(true);
      const text = await Bun.file(path).text();
      const parsed = JSON.parse(text) as {
        schemaVersion: number;
        gate: string;
        size: number;
        metadata: { resultSize: number; hostname: string; pid: number; bunVersion: string };
        payload: { status: string };
      };
      expect(parsed.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
      expect(parsed.gate).toBe("bunfig-policy");
      expect(parsed.size).toBeGreaterThan(0);
      expect(parsed.metadata.resultSize).toBeGreaterThan(0);
      expect(parsed.metadata.hostname).toBeTruthy();
      expect(parsed.metadata.pid).toBe(process.pid);
      expect(parsed.metadata.bunVersion).toBe(Bun.version);
      expect(parsed.payload.status).toBe("pass");
      expect(store.relativePath(path)).toMatch(/^\.kimi\/artifacts\/bunfig-policy\//);
    });
  });

  test("list returns chronological relative paths", async () => {
    await withTempDir("artifact-store-list-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("perf-gate", { n: 1 });
      await Bun.sleep(2);
      await store.save("perf-gate", { n: 2 });

      const files = await store.list("perf-gate");
      expect(files).toHaveLength(2);
      expect(files[0]).toMatch(/^\.kimi\/artifacts\/perf-gate\//);
      expect(files[1]).toMatch(/^\.kimi\/artifacts\/perf-gate\//);
    });
  });

  test("listGates returns gate directories with saved artifacts", async () => {
    await withTempDir("artifact-store-gates-", async (dir) => {
      const store = new ArtifactStore(dir);
      expect(await store.listGates()).toEqual([]);

      await store.save("bunfig-policy", { n: 1 });
      await store.save("card-probe", { n: 2 });

      expect(await store.listGates()).toEqual(["bunfig-policy", "card-probe"]);
    });
  });

  test("extractArtifactTimestamp helpers parse filename stamps", () => {
    const path = ".kimi/artifacts/bunfig-policy/2026-06-19T14-40-33-297Z.json";
    expect(extractArtifactTimestamp(path)).toBe("2026-06-19T14:40:33.297Z");
    expect(extractArtifactTimestampMs(path)).toBe(Date.parse("2026-06-19T14:40:33.297Z"));
    expect(extractArtifactTimestamp(".kimi/artifacts/x/bad.json")).toBeNull();
  });

  test("listFiltered applies since and limit without stat", async () => {
    await withTempDir("artifact-store-filter-", async (dir) => {
      const store = new ArtifactStore(dir);
      const gateDir = join(dir, ".kimi", "artifacts", "perf-gate");
      makeDir(gateDir, { recursive: true });

      const oldStamp = "2026-06-01T00-00-00-000Z";
      const midStamp = "2026-06-10T12-00-00-000Z";
      const newStamp = "2026-06-19T12-00-00-000Z";
      await Bun.write(join(gateDir, `${oldStamp}.json`), "{}");
      await Bun.write(join(gateDir, `${midStamp}.json`), "{}");
      await Bun.write(join(gateDir, `${newStamp}.json`), "{}");

      const since = await store.listFiltered("perf-gate", { since: "2026-06-10T00:00:00.000Z" });
      expect(since.total).toBe(3);
      expect(since.files).toHaveLength(2);
      expect(since.files[0]).toContain(midStamp);

      const limited = await store.listFiltered("perf-gate", { limit: 1 });
      expect(limited.total).toBe(3);
      expect(limited.files).toHaveLength(1);
      expect(limited.files[0]).toContain(newStamp);
    });
  });

  test("prune uses GATE_LEVEL_PRUNE_MS when level is set", async () => {
    await withTempDir("artifact-store-prune-level-", async (dir) => {
      const store = new ArtifactStore(dir);
      const gateDir = join(dir, ".kimi", "artifacts", "perf-gate");
      makeDir(gateDir, { recursive: true });

      const oldStamp = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace(/[:.]/g, "-");
      const recentStamp = new Date().toISOString().replace(/[:.]/g, "-");
      await Bun.write(join(gateDir, `${oldStamp}.json`), '{"legacy":true}');
      await Bun.write(join(gateDir, `${recentStamp}.json`), '{"legacy":true}');

      const removed = await store.prune("perf-gate", { level: 2 });
      expect(removed.removed).toBe(1);
      expect(await store.list("perf-gate")).toHaveLength(1);
    });
  });

  test("prune removes artifacts older than maxAgeMs", async () => {
    await withTempDir("artifact-store-prune-", async (dir) => {
      const store = new ArtifactStore(dir);
      const gateDir = join(dir, ".kimi", "artifacts", "perf-gate");
      makeDir(gateDir, { recursive: true });

      const oldStamp = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
        .toISOString()
        .replace(/[:.]/g, "-");
      const recentStamp = new Date().toISOString().replace(/[:.]/g, "-");
      await Bun.write(join(gateDir, `${oldStamp}.json`), '{"legacy":true}');
      await Bun.write(join(gateDir, `${recentStamp}.json`), '{"legacy":true}');

      const removed = await store.prune("perf-gate", { maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
      expect(removed.removed).toBe(1);
      expect(await store.list("perf-gate")).toHaveLength(1);
    });
  });

  test("listEntries reads size and resultSize from envelope without stat", async () => {
    await withTempDir("artifact-store-entries-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("card-probe", { n: 1 });

      const listed = await store.listEntries("card-probe", { limit: 1 });
      expect(listed.entries).toHaveLength(1);
      expect(listed.entries[0]?.size).toBeGreaterThan(0);
      expect(listed.entries[0]?.resultSize).toBeGreaterThan(0);
      expect(listed.entries[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test("save stores dependsOn metadata and getDependencies retrieves it", async () => {
    await withTempDir("artifact-store-deps-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("strategy-performance", { pnl: 1 });
      await Bun.sleep(2);
      await store.save("strategy-performance", { pnl: 2 });
      const perfFiles = await store.list("strategy-performance");
      expect(perfFiles).toHaveLength(2);

      const driftPath = await store.save(
        "model-drift",
        { drift: 0.12 },
        {
          dependsOn: [
            { gate: "strategy-performance", limit: 2 },
            {
              gate: "strategy-performance",
              paths: [perfFiles[0]!],
            },
          ],
        }
      );

      const relativePath = store.relativePath(driftPath);
      const queries = await store.getDependencies(relativePath);
      expect(queries).toHaveLength(2);
      expect(queries[0]?.gate).toBe("strategy-performance");
      expect(queries[0]?.limit).toBe(2);
      expect(queries[1]?.paths).toEqual([perfFiles[0] ?? ""]);

      const resolved = await store.resolveDependsOn(queries);
      expect(resolved[0]?.paths).toHaveLength(2);
      expect(resolved[1]?.paths).toEqual([perfFiles[0] ?? ""]);

      const envelope = await store.readEnvelope(relativePath);
      expect(envelope?.metadata?.lineageMermaid).toContain("graph TD");
      expect(envelope?.metadata?.lineageMermaid).toContain("strategy-performance");

      const graph = await store.buildLineageGraph(relativePath);
      expect(graph?.stored).toBe(true);
      expect(graph?.mermaid).toContain("model-drift");
    });
  });

  test("buildLineageGraph falls back to runtime metadata.lineage", async () => {
    await withTempDir("artifact-store-run-lineage-", async (dir) => {
      const store = new ArtifactStore(dir);
      const upstreamPath = await store.save("bunfig-policy", { status: "pass" });
      const perfPath = await store.save(
        "perf-gate",
        { status: "pass" },
        {
          lineage: {
            dependencies: ["bunfig-policy"],
            upstreamArtifacts: [store.relativePath(upstreamPath)],
          },
        }
      );

      const graph = await store.buildLineageGraph(store.relativePath(perfPath));
      expect(graph?.lineageSource).toBe("runtime");
      expect(graph?.mermaid).toContain("bunfig-policy");
      expect(graph?.mermaid).toContain("perf-gate");
    });
  });

  test("getLatest returns newest unwrapped payload", async () => {
    await withTempDir("artifact-store-latest-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("card-probe", { n: 1 });
      await Bun.sleep(2);
      await store.save("card-probe", { n: 2 });

      const latest = await store.getLatest("card-probe");
      expect(latest).not.toBeNull();
      expect((latest!.payload as { n: number }).n).toBe(2);
      expect(latest!.relativePath).toContain(".kimi/artifacts/card-probe/");
    });
  });

  test("pruneByCount keeps newest artifacts", async () => {
    await withTempDir("artifact-store-prune-count-", async (dir) => {
      const store = new ArtifactStore(dir);
      for (let i = 0; i < 5; i++) {
        await store.save("perf-gate", { n: i });
        await Bun.sleep(2);
      }

      const pruned = await store.pruneByCount("perf-gate", { maxCount: 2 });
      expect(pruned.removed).toBe(3);
      expect(await store.list("perf-gate")).toHaveLength(2);

      const latest = await store.getLatest("perf-gate");
      expect((latest!.payload as { n: number }).n).toBe(4);
    });
  });

  test("save injects session context from environment", async () => {
    await withTempDir("artifact-store-session-", async (dir) => {
      const prev = {
        KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
        HERDR_WORKSPACE_ID: Bun.env.HERDR_WORKSPACE_ID,
        HERDR_SESSION_ID: Bun.env.HERDR_SESSION_ID,
        HERDR_PANE_ID: Bun.env.HERDR_PANE_ID,
        KIMI_RUN_ID: Bun.env.KIMI_RUN_ID,
        KIMI_PARENT_RUN_ID: Bun.env.KIMI_PARENT_RUN_ID,
      };
      Bun.env.KIMI_CODE_SESSION = "wd_test_session";
      delete Bun.env.HERDR_WORKSPACE_ID;
      Bun.env.HERDR_SESSION_ID = "ws_trading";
      Bun.env.HERDR_PANE_ID = "pane_reviewer";
      delete Bun.env.KIMI_RUN_ID;
      delete Bun.env.KIMI_PARENT_RUN_ID;
      try {
        expect(resolveArtifactSessionContext()).toEqual({
          sessionId: "wd_test_session",
          workspaceId: "ws_trading",
          paneId: "pane_reviewer",
          agentId: "pane_reviewer",
        });

        const store = new ArtifactStore(dir);
        const path = await store.save("model-drift", { status: "pass" });
        const envelope = await store.readEnvelope(store.relativePath(path));
        expect(envelope?.metadata?.sessionId).toBe("wd_test_session");
        expect(envelope?.metadata?.workspaceId).toBe("ws_trading");
        expect(envelope?.metadata?.paneId).toBe("pane_reviewer");
        expect(envelope?.metadata?.agentId).toBe("pane_reviewer");
        expect(envelope?.metadata?.runId).toMatch(/^run_/);
      } finally {
        for (const [key, value] of Object.entries(prev)) {
          if (value === undefined) delete Bun.env[key];
          else Bun.env[key] = value;
        }
      }
    });
  });

  test("listEntries filters by runId", async () => {
    await withTempDir("artifact-store-run-filter-", async (dir) => {
      const store = new ArtifactStore(dir);
      const pathA = await store.save("perf-gate", { n: 1 }, { runId: "run_test_a" });
      await Bun.sleep(2);
      await store.save("perf-gate", { n: 2 }, { runId: "run_test_b" });

      const onlyA = await store.listEntries("perf-gate", { runId: "run_test_a" });
      expect(onlyA.entries).toHaveLength(1);
      expect(onlyA.entries[0]?.runId).toBe("run_test_a");
      expect(onlyA.entries[0]?.path).toBe(store.relativePath(pathA));
    });
  });

  test("listEntries filters by sessionId", async () => {
    await withTempDir("artifact-store-session-filter-", async (dir) => {
      const store = new ArtifactStore(dir);
      const prev = Bun.env.KIMI_CODE_SESSION;
      Bun.env.KIMI_CODE_SESSION = "session_a";
      await store.save("perf-gate", { n: 1 });
      Bun.env.KIMI_CODE_SESSION = "session_b";
      await Bun.sleep(2);
      await store.save("perf-gate", { n: 2 });
      if (prev === undefined) delete Bun.env.KIMI_CODE_SESSION;
      else Bun.env.KIMI_CODE_SESSION = prev;

      const onlyA = await store.listEntries("perf-gate", { sessionId: "session_a" });
      expect(onlyA.entries).toHaveLength(1);
      expect(onlyA.entries[0]?.sessionId).toBe("session_a");

      expect(matchesArtifactSessionContext({ sessionId: "session_a" } as never, {})).toBe(true);
      expect(
        matchesArtifactSessionContext({ sessionId: "session_a" } as never, {
          sessionId: "session_b",
        })
      ).toBe(false);
    });
  });

  test("save stamps runId from meta and filters listEntries by runId", async () => {
    await withTempDir("artifact-store-run-id-", async (dir) => {
      const store = new ArtifactStore(dir);
      const runA = generateRunId();
      const runB = generateRunId();
      await store.save("model-drift", { n: 1 }, { runId: runA });
      await Bun.sleep(2);
      await store.save("model-drift", { n: 2 }, { runId: runB });

      const onlyA = await store.listEntries("model-drift", { runId: runA });
      expect(onlyA.entries).toHaveLength(1);
      expect(onlyA.entries[0]?.runId).toBe(runA);

      const manifest: ArtifactRunManifest = {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        runId: runA,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": ".kimi/artifacts/model-drift/example.json" },
        status: "pass",
      };
      await store.saveRunManifest(manifest);
      expect(await store.readRunManifest(runA)).toMatchObject({ runId: runA, status: "pass" });
      expect(await store.listRunIds()).toContain(runA);
      expect(await store.listRunManifests({ runId: runA })).toMatchObject([{ runId: runA }]);
    });
  });

  test("artifactFilterFromSessionRoute maps Kimi vs Herdr session paths", () => {
    expect(artifactFilterFromSessionRoute("wd_abc123")).toEqual({ sessionId: "wd_abc123" });
    expect(artifactFilterFromSessionRoute("staging")).toEqual({ workspaceId: "staging" });
    expect(artifactFilterFromSessionRoute("primary")).toEqual({});
  });

  test("generateRunId uses run_ prefix and timestamp segment", () => {
    const id = generateRunId(new Date("2026-06-19T16:01:09.000Z"));
    expect(id).toMatch(/^run_20260619_160109_/);
  });

  test("buildPaneIdentityExports includes pane id for pane run prefix", async () => {
    const { buildPaneIdentityExports } = await import("../src/lib/artifact-identity.ts");
    const prev = Bun.env.KIMI_CODE_SESSION;
    Bun.env.KIMI_CODE_SESSION = "wd_pane_export";
    try {
      expect(buildPaneIdentityExports("pane_alpha")).toContain('HERDR_PANE_ID="pane_alpha"');
      expect(buildPaneIdentityExports("pane_alpha")).toContain(
        'KIMI_CODE_SESSION="wd_pane_export"'
      );
    } finally {
      if (prev === undefined) delete Bun.env.KIMI_CODE_SESSION;
      else Bun.env.KIMI_CODE_SESSION = prev;
    }
  });

  test("artifactIdentityEnv propagates Kimi session and Herdr session (not workspace as session id)", async () => {
    const prev = {
      KIMI_CODE_SESSION: Bun.env.KIMI_CODE_SESSION,
      HERDR_PANE_ID: Bun.env.HERDR_PANE_ID,
      KIMI_RUN_ID: Bun.env.KIMI_RUN_ID,
    };
    Bun.env.KIMI_CODE_SESSION = "wd_propagate_test";
    Bun.env.HERDR_PANE_ID = "pane_orchestrator";
    Bun.env.KIMI_RUN_ID = "run_parent_abc";
    try {
      expect(artifactIdentityEnv("ws_trading", "herdr-main")).toEqual({
        HERDR_WORKSPACE_ID: "ws_trading",
        HERDR_SESSION: "herdr-main",
        HERDR_SESSION_ID: "herdr-main",
        KIMI_CODE_SESSION: "wd_propagate_test",
        HERDR_PANE_ID: "pane_orchestrator",
        KIMI_PARENT_RUN_ID: "run_parent_abc",
      });
      expect(artifactIdentityEnv({ paneId: "pane_child" })).toMatchObject({
        HERDR_PANE_ID: "pane_child",
        KIMI_PARENT_RUN_ID: "run_parent_abc",
      });
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete Bun.env[key];
        else Bun.env[key] = value;
      }
    }
  });

  test("KIMI_ARTIFACTS_DIR overrides default artifact root", async () => {
    await withTempDir("artifact-store-env-dir-", async (dir) => {
      const prev = Bun.env.KIMI_ARTIFACTS_DIR;
      Bun.env.KIMI_ARTIFACTS_DIR = "var/trading-artifacts";
      try {
        const store = new ArtifactStore(dir);
        const path = await store.save("model-drift", { status: "pass" });
        expect(path).toContain(join(dir, "var", "trading-artifacts", "model-drift"));
        expect(store.relativePath(path)).toMatch(/^var\/trading-artifacts\/model-drift\//);
      } finally {
        if (prev === undefined) delete Bun.env.KIMI_ARTIFACTS_DIR;
        else Bun.env.KIMI_ARTIFACTS_DIR = prev;
      }
    });
  });

  test("normalizeArtifactIdentityValue validates allowed characters and length", () => {
    expect(normalizeArtifactIdentityValue("  wd_a-1  ")).toBe("wd_a-1");
    expect(normalizeArtifactIdentityValue("with space")).toBeUndefined();
    expect(normalizeArtifactIdentityValue("a".repeat(129))).toBeUndefined();
    expect(normalizeArtifactIdentityValue("")).toBeUndefined();
    expect(normalizeArtifactIdentityValue(undefined)).toBeUndefined();
  });

  test("normalizeArtifactSessionContext drops invalid identity values", () => {
    const ctx = normalizeArtifactSessionContext({
      sessionId: "  valid-1  ",
      workspaceId: "invalid space",
      paneId: "pane-1",
      agentId: "",
      runId: "run_123",
      parentRunId: "x".repeat(200),
    });
    expect(ctx).toEqual({
      sessionId: "valid-1",
      paneId: "pane-1",
      runId: "run_123",
    });
  });

  test("artifactScopeKey falls back through identity fields", () => {
    expect(artifactScopeKey({ sessionId: "s1" })).toBe("s1");
    expect(artifactScopeKey({ workspaceId: "w1" })).toBe("w1");
    expect(artifactScopeKey({ runId: "r1" })).toBe("r1");
    expect(artifactScopeKey({})).toBe("default");
  });

  test("save indexes artifact and writes content hash", async () => {
    await withTempDir("artifact-store-index-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("model-drift", { ok: true, n: 1 }, { sessionId: "s1", runId: "r1" });
      const rows = store.getIndex().find({ sessionIds: ["s1"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("pass");
      expect(rows[0]?.contentHash).toBe(computeArtifactContentHash({ ok: true, n: 1 }));

      const distinct = store.getIndex().distinct();
      expect(distinct.sessionIds).toContain("s1");
      expect(distinct.runIds).toContain("r1");
    });
  });

  test("listEntries uses SQLite index for identity filters", async () => {
    await withTempDir("artifact-store-index-list-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("model-drift", { ok: true }, { sessionId: "s1" });
      await Bun.sleep(2);
      await store.save("model-drift", { ok: false }, { sessionId: "s2" });

      const filtered = await store.listEntries("model-drift", { sessionId: "s1" });
      expect(filtered.entries).toHaveLength(1);
      expect(filtered.entries[0]?.sessionId).toBe("s1");

      const byStatus = await store.listEntries("model-drift", { statuses: ["fail"] });
      expect(byStatus.entries).toHaveLength(1);
      expect(byStatus.entries[0]?.sessionId).toBe("s2");
    });
  });

  test("prune removes artifacts from index", async () => {
    await withTempDir("artifact-store-prune-index-", async (dir) => {
      const store = new ArtifactStore(dir);
      const path = await store.save("old-gate", { ok: true }, { sessionId: "s1" });
      expect(store.getIndex().find({})).toHaveLength(1);
      await store.prune("old-gate", { maxAgeMs: -1 });
      expect(pathExists(path)).toBe(false);
      expect(store.getIndex().find({})).toHaveLength(0);
    });
  });

  test("listRunArtifactRefs prefers SQLite index over manifest map", async () => {
    await withTempDir("artifact-store-run-refs-", async (dir) => {
      const store = new ArtifactStore(dir);
      const runId = "run_hybrid_a";
      const path = await store.save("model-drift", { ok: true }, { runId });
      const relativePath = path.slice(dir.length + 1);
      const manifest = {
        schemaVersion: 1 as const,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["model-drift"],
        artifacts: { "model-drift": "stale/path.json" },
        status: "pass" as const,
      };
      await store.saveRunManifest(manifest);

      const refs = await store.listRunArtifactRefs(runId, manifest);
      expect(refs).toHaveLength(1);
      expect(refs[0]?.indexSource).toBe(true);
      expect(refs[0]?.relativePath).toBe(relativePath);
    });
  });

  test("syncIndexIfDrifted rebuilds when filesystem and index counts diverge", async () => {
    await withTempDir("artifact-store-sync-drift-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("lint", { ok: true });
      store.getIndex().reset();
      const sync = await store.syncIndexIfDrifted();
      expect(sync.rebuilt).toBe(true);
      expect(sync.fsCount).toBe(1);
      expect(sync.indexCount).toBe(1);
    });
  });

  test("diffArtifactPaths compares content hashes", async () => {
    await withTempDir("artifact-store-diff-", async (dir) => {
      const store = new ArtifactStore(dir);
      const pathA = await store.save("lint", { ok: true, n: 1 });
      await Bun.sleep(2);
      const pathB = await store.save("lint", { ok: true, n: 2 });
      const relA = pathA.slice(dir.length + 1);
      const relB = pathB.slice(dir.length + 1);
      const diff = await store.diffArtifactPaths(relA, relB);
      expect(diff.ok).toBe(true);
      expect(diff.equal).toBe(false);
      expect(diff.hashA).toMatch(/^[a-f0-9]{64}$/);
      expect(diff.hashB).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  test("rebuildIndex restores index from filesystem", async () => {
    await withTempDir("artifact-store-rebuild-index-", async (dir) => {
      const store = new ArtifactStore(dir);
      await store.save("lint", { ok: true }, { sessionId: "s_rebuild", runId: "run_rebuild" });
      store.getIndex().reset();

      const rebuilt = await store.rebuildIndex();
      expect(rebuilt).toBe(1);
      expect(store.getIndex().findByRunId("run_rebuild")).toHaveLength(1);
    });
  });
});
