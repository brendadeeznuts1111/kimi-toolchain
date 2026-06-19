import { describe, expect, test } from "bun:test";
import { join } from "path";
import { ArtifactIndex, computeArtifactContentHash } from "../src/lib/artifact-index.ts";
import type { ArtifactEnvelope } from "../src/lib/artifact-store.ts";
import { withTempDir } from "./helpers.ts";

function makeEnvelope(
  gate: string,
  overrides: {
    savedAt?: string;
    size?: number;
    payload?: unknown;
    metadata?: Partial<ArtifactEnvelope["metadata"]>;
  } = {}
): ArtifactEnvelope {
  const payload = overrides.payload ?? { ok: true };
  return {
    schemaVersion: 1,
    gate,
    savedAt: overrides.savedAt ?? new Date().toISOString(),
    size: overrides.size ?? 100,
    metadata: {
      hostname: "localhost",
      pid: 1,
      bunVersion: "1.0.0",
      resultSize: 50,
      ...overrides.metadata,
    },
    payload,
  };
}

describe("artifact-index", () => {
  test("computeArtifactContentHash returns stable hex", () => {
    const a = computeArtifactContentHash({ ok: true });
    const b = computeArtifactContentHash({ ok: true });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(computeArtifactContentHash({ ok: false })).not.toBe(a);
  });

  test("indexEnvelope and find round-trip", async () => {
    await withTempDir("artifact-index-", async (dir) => {
      const index = new ArtifactIndex(dir);
      const envelope = makeEnvelope("lint", {
        metadata: { sessionId: "wd_a", workspaceId: "prod", runId: "run_1" },
      });
      const relativePath = ".kimi/artifacts/lint/2026-01-01T00-00-00-0Z.json";
      const absolutePath = join(dir, relativePath);
      index.indexEnvelope(envelope, relativePath, absolutePath);

      const rows = index.find({ gates: ["lint"] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.gate).toBe("lint");
      expect(rows[0]?.sessionId).toBe("wd_a");
      expect(rows[0]?.workspaceId).toBe("prod");
      expect(rows[0]?.runId).toBe("run_1");
      expect(rows[0]?.status).toBe("pass");

      index.close();
    });
  });

  test("find filters by session, workspace, run, status", async () => {
    await withTempDir("artifact-index-filter-", async (dir) => {
      const index = new ArtifactIndex(dir);
      const base = new Date("2026-01-15T00:00:00.000Z").toISOString();
      const paths = [
        { gate: "a", sessionId: "s1", workspaceId: "w1", runId: "r1", payload: { ok: true } },
        { gate: "a", sessionId: "s2", workspaceId: "w1", runId: "r2", payload: { ok: false } },
        { gate: "b", sessionId: "s1", workspaceId: "w2", runId: "r1", payload: { ok: true } },
      ];
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i]!;
        const savedAt = new Date(Date.parse(base) + i * 1000).toISOString();
        const relativePath = `.kimi/artifacts/${p.gate}/2026-01-15T00-00-0${i}-0Z.json`;
        const envelope = makeEnvelope(p.gate, {
          savedAt,
          metadata: { sessionId: p.sessionId, workspaceId: p.workspaceId, runId: p.runId },
          payload: p.payload,
        });
        index.indexEnvelope(envelope, relativePath, join(dir, relativePath));
      }

      expect(index.find({ sessionIds: ["s1"] })).toHaveLength(2);
      expect(index.find({ workspaceIds: ["w1"] })).toHaveLength(2);
      expect(index.find({ runIds: ["r1"] })).toHaveLength(2);
      expect(index.find({ statuses: ["fail"] })).toHaveLength(1);
      expect(index.find({ sessionIds: ["s1"], statuses: ["pass"] })).toHaveLength(2);
      expect(index.find({ gates: ["a"], sessionIds: ["s2"] })).toHaveLength(1);

      index.close();
    });
  });

  test("find supports since/until and limit", async () => {
    await withTempDir("artifact-index-range-", async (dir) => {
      const index = new ArtifactIndex(dir);
      for (let i = 0; i < 5; i++) {
        const savedAt = new Date(`2026-01-${10 + i}T00:00:00.000Z`).toISOString();
        const relativePath = `.kimi/artifacts/g/2026-01-${10 + i}T00-00-00-0Z.json`;
        const envelope = makeEnvelope("g", { savedAt });
        index.indexEnvelope(envelope, relativePath, join(dir, relativePath));
      }

      expect(index.find({ since: "2026-01-12T00:00:00.000Z" })).toHaveLength(3);
      expect(index.find({ until: "2026-01-12T00:00:00.000Z" })).toHaveLength(3);
      expect(
        index.find({ since: "2026-01-11T00:00:00.000Z", until: "2026-01-13T00:00:00.000Z" })
      ).toHaveLength(3);
      expect(index.find({ limit: 2 })).toHaveLength(2);
      expect(index.find({ limit: 2, order: "asc" })[0]?.savedAt).toContain("2026-01-10");

      index.close();
    });
  });

  test("distinct returns unique identity values", async () => {
    await withTempDir("artifact-index-distinct-", async (dir) => {
      const index = new ArtifactIndex(dir);
      for (const [gate, sessionId] of [
        ["g1", "s1"],
        ["g1", "s1"],
        ["g2", "s2"],
      ] as const) {
        const relativePath = `.kimi/artifacts/${gate}/2026-01-01T00-00-00-${gate}.json`;
        const envelope = makeEnvelope(gate, { metadata: { sessionId } });
        index.indexEnvelope(envelope, relativePath, join(dir, relativePath));
      }

      const distinct = index.distinct();
      expect(distinct.sessionIds).toEqual(["s1", "s2"]);
      expect(distinct.statuses).toEqual(["pass"]);

      index.close();
    });
  });

  test("countByGate aggregates per gate", async () => {
    await withTempDir("artifact-index-count-", async (dir) => {
      const index = new ArtifactIndex(dir);
      for (let i = 0; i < 3; i++) {
        const gate = i < 2 ? "a" : "b";
        const relativePath = `.kimi/artifacts/${gate}/2026-01-01T00-00-0${i}-${gate}.json`;
        index.indexEnvelope(makeEnvelope(gate), relativePath, join(dir, relativePath));
      }

      const counts = index.countByGate({});
      expect(counts).toHaveLength(2);
      expect(counts.find((c) => c.gate === "a")?.count).toBe(2);
      expect(counts.find((c) => c.gate === "b")?.count).toBe(1);

      index.close();
    });
  });

  test("removeByPath deletes row", async () => {
    await withTempDir("artifact-index-remove-", async (dir) => {
      const index = new ArtifactIndex(dir);
      const relativePath = ".kimi/artifacts/g/2026-01-01T00-00-00-0Z.json";
      const absolutePath = join(dir, relativePath);
      index.indexEnvelope(makeEnvelope("g"), relativePath, absolutePath);
      expect(index.find({})).toHaveLength(1);
      index.removeByPath(absolutePath);
      expect(index.find({})).toHaveLength(0);
      index.close();
    });
  });

  test("findByRunId and findBySession convenience queries", async () => {
    await withTempDir("artifact-index-run-session-", async (dir) => {
      const index = new ArtifactIndex(dir);
      const savedAt = "2026-02-01T00:00:00.000Z";
      index.indexEnvelope(
        makeEnvelope("gate-a", {
          savedAt,
          metadata: { sessionId: "wd_a", runId: "run_a" },
        }),
        ".kimi/artifacts/gate-a/a.json",
        join(dir, ".kimi/artifacts/gate-a/a.json")
      );
      index.indexEnvelope(
        makeEnvelope("gate-b", {
          savedAt,
          metadata: { sessionId: "wd_b", runId: "run_b" },
        }),
        ".kimi/artifacts/gate-b/b.json",
        join(dir, ".kimi/artifacts/gate-b/b.json")
      );

      expect(index.findByRunId("run_a")).toHaveLength(1);
      expect(index.findByRunId("run_a")[0]?.gate).toBe("gate-a");
      expect(index.findBySession("wd_a", { limit: 5 })).toHaveLength(1);

      index.close();
    });
  });

  test("reset removes sqlite wal and shm sidecars", async () => {
    await withTempDir("artifact-index-reset-wal-", async (dir) => {
      const artifactRoot = join(dir, ".kimi", "artifacts");
      const index = new ArtifactIndex(artifactRoot);
      const envelope = makeEnvelope("g", { metadata: { sessionId: "s1" } });
      index.indexEnvelope(envelope, ".kimi/artifacts/g/f.json", join(artifactRoot, "g/f.json"));
      expect(index.exists()).toBe(true);

      index.reset();
      expect(index.exists()).toBe(false);
      index.stats();
      expect(index.find({ sessionIds: ["s1"] })).toHaveLength(0);

      index.close();
    });
  });

  test("rebuild scans filesystem", async () => {
    await withTempDir("artifact-index-rebuild-", async (dir) => {
      const artifactRoot = join(dir, ".kimi", "artifacts");
      const index = new ArtifactIndex(artifactRoot);
      const relativePath = "g/2026-01-01T00-00-00-0Z.json";
      const absolutePath = join(artifactRoot, relativePath);
      const envelope = makeEnvelope("g", { metadata: { sessionId: "s1" } });
      const text = JSON.stringify(envelope, null, 2);
      await Bun.write(absolutePath, text);

      const indexed = await index.rebuild(async (gateRelativePath) => {
        const projectRelativePath = join(".kimi", "artifacts", gateRelativePath);
        const text = await Bun.file(join(artifactRoot, gateRelativePath)).text();
        const envelope = JSON.parse(text) as ArtifactEnvelope;
        return { envelope, relativePath: projectRelativePath };
      });
      expect(indexed).toBe(1);
      expect(index.find({ sessionIds: ["s1"] })).toHaveLength(1);

      index.close();
    });
  });
});
