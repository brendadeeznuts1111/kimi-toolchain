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
});
