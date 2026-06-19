import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, pathExists } from "../src/lib/bun-io.ts";
import {
  ARTIFACT_SCHEMA_VERSION,
  ArtifactStore,
  extractArtifactTimestamp,
  extractArtifactTimestampMs,
} from "../src/lib/artifact-store.ts";
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
      expect(queries[1]?.paths).toEqual([perfFiles[0]]);

      const resolved = await store.resolveDependsOn(queries);
      expect(resolved[0]?.paths).toHaveLength(2);
      expect(resolved[1]?.paths).toEqual([perfFiles[0]]);

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
});
