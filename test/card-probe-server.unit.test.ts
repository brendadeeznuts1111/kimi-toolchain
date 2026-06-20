/** @description Probe cache server routes and lifecycle. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { extractArtifactTimestamp, startProbeServer } from "../src/lib/card-probe-server.ts";
import { buildBenchmarkConvergenceBlock } from "../src/lib/benchmark-convergence.ts";
import {
  BENCHMARK_API_SCHEMA_VERSION,
  type BenchmarkApiEnvelope,
} from "../src/lib/effect-benchmark-card.ts";
import { withTempDir } from "./helpers.ts";

function mockBenchmarkEnvelope(): BenchmarkApiEnvelope {
  const generatedAt = "2026-06-20T00:00:00.000Z";
  return {
    ok: true,
    schemaVersion: BENCHMARK_API_SCHEMA_VERSION,
    timestamp: generatedAt,
    runner: "serve-probe",
    thresholdSource: "test",
    summary: {
      total: 1,
      passing: 1,
      measured: 1,
      skipped: 0,
      partialSuccess: false,
      regressions: 0,
      timedOut: false,
    },
    sparklines: {},
    gates: { effectBenchmarkGate: { status: "pass" } },
    metadata: { convergence: buildBenchmarkConvergenceBlock("serve-probe") },
    generatedAt,
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
    philosophy: "test fixture",
  };
}

describe("card-probe-server", () => {
  test("extractArtifactTimestamp parses filename stamps without stat", () => {
    expect(
      extractArtifactTimestamp(".kimi/artifacts/bunfig-policy/2026-06-19T14-40-33-297Z.json")
    ).toBe("2026-06-19T14:40:33.297Z");
    expect(extractArtifactTimestamp(".kimi/artifacts/card-probe/not-a-stamp.json")).toBeNull();
  });

  test("serves /api/health, /api/cards, and /api/refresh", async () => {
    const handle = await startProbeServer({ port: 0, probeConfig: { timeoutMs: 100 } });
    try {
      const health = await fetch(`${handle.url}/api/health`);
      expect(health.status).toBe(200);
      expect(await health.text()).toBe("ok");

      const head = await fetch(`${handle.url}/api/health`, { method: "HEAD" });
      expect(head.status).toBe(200);

      const cards = await fetch(`${handle.url}/api/cards`);
      expect(cards.status).toBe(200);
      const cardsBody = (await cards.json()) as {
        ok: boolean;
        cards: unknown[];
        total: number;
        summary: { pass: number; fail: number; unknown: number; total: number };
        fetchedAt: string;
        configStatus: { tool: string; aligned: boolean; gates: unknown[] };
      };
      expect(cardsBody.ok).toBe(true);
      expect(typeof cardsBody.total).toBe("number");
      expect(typeof cardsBody.fetchedAt).toBe("string");
      expect(cardsBody.summary.total).toBe(cardsBody.total);
      expect(cardsBody.configStatus.tool).toBe("config-status");
      expect(cardsBody.configStatus.aligned).toBe(true);
      expect(cardsBody.configStatus.gates.length).toBeGreaterThanOrEqual(3);

      const configStatus = await fetch(`${handle.url}/api/config-status`);
      expect(configStatus.status).toBe(200);
      const configStatusBody = (await configStatus.json()) as {
        ok: boolean;
        configStatus: { tool: string; aligned: boolean; gates: unknown[] };
        fetchedAt: string;
      };
      expect(configStatusBody.ok).toBe(true);
      expect(configStatusBody.configStatus.tool).toBe("config-status");
      expect(configStatusBody.configStatus.aligned).toBe(true);
      expect(configStatusBody.configStatus.gates.length).toBeGreaterThanOrEqual(3);
      expect(typeof configStatusBody.fetchedAt).toBe("string");

      const refreshGet = await fetch(`${handle.url}/api/refresh`);
      expect(refreshGet.status).toBe(200);
      const refreshGetBody = (await refreshGet.json()) as { ok: boolean; refreshedAt: string };
      expect(refreshGetBody.ok).toBe(true);
      expect(typeof refreshGetBody.refreshedAt).toBe("string");

      const refreshPost = await fetch(`${handle.url}/api/refresh`, { method: "POST" });
      expect(refreshPost.status).toBe(200);

      const notFound = await fetch(`${handle.url}/api/nope`);
      expect(notFound.status).toBe(404);
      const notFoundBody = (await notFound.json()) as { ok: boolean; routes: unknown[] };
      expect(notFoundBody.ok).toBe(false);
      expect(Array.isArray(notFoundBody.routes)).toBe(true);
    } finally {
      handle.stop();
    }
  });

  test("serves artifact inspection routes", async () => {
    await withTempDir("card-probe-server-artifacts-", async (dir) => {
      const handle = await startProbeServer({
        port: 0,
        probeConfig: { timeoutMs: 100 },
        projectRoot: dir,
        saveArtifact: true,
      });
      try {
        const gates = await fetch(`${handle.url}/api/artifacts`);
        expect(gates.status).toBe(200);
        const gatesBody = (await gates.json()) as {
          ok: boolean;
          gates: string[];
          count: number;
          projectRoot: string;
        };
        expect(gatesBody.ok).toBe(true);
        expect(gatesBody.projectRoot).toBe(dir);
        expect(gatesBody.gates).toContain("card-probe");
        expect(gatesBody.count).toBe(gatesBody.gates.length);

        const list = await fetch(`${handle.url}/api/artifacts/card-probe?limit=1`);
        expect(list.status).toBe(200);
        const listBody = (await list.json()) as {
          ok: boolean;
          gate: string;
          count: number;
          total: number;
          limit: number;
          files: Array<{
            path: string;
            timestamp: string | null;
            size?: number;
            resultSize?: number;
          }>;
        };
        expect(listBody.ok).toBe(true);
        expect(listBody.gate).toBe("card-probe");
        expect(listBody.limit).toBe(1);
        expect(listBody.total).toBeGreaterThanOrEqual(listBody.count);
        expect(listBody.count).toBe(listBody.files.length);
        expect(listBody.files.length).toBe(1);
        expect(listBody.files[0]?.path).toMatch(/^\.kimi\/artifacts\/card-probe\//);
        expect(listBody.files[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\./);
        expect(listBody.files[0]?.size).toBeGreaterThan(0);
        expect(listBody.files[0]?.resultSize).toBeGreaterThan(0);

        const latest = await fetch(`${handle.url}/api/artifacts/card-probe/latest`);
        expect(latest.status).toBe(200);
        const latestBody = (await latest.json()) as {
          ok: boolean;
          gate: string;
          path: string;
          payload: { source: string; statuses: unknown[] };
        };
        expect(latestBody.ok).toBe(true);
        expect(latestBody.gate).toBe("card-probe");
        expect(latestBody.payload.source).toBe("serve-probe");
        expect(Array.isArray(latestBody.payload.statuses)).toBe(true);
        expect(pathExists(join(dir, latestBody.path))).toBe(true);

        const missing = await fetch(`${handle.url}/api/artifacts/missing-gate/latest`);
        expect(missing.status).toBe(404);

        const refreshPost = await fetch(`${handle.url}/api/artifacts/card-probe/refresh`, {
          method: "POST",
        });
        expect(refreshPost.status).toBe(403);
        const refreshBody = (await refreshPost.json()) as {
          error: string;
          reason: string;
          docs: string;
          futureOptIn: { flag: string; env: string };
        };
        expect(refreshBody.error).toBe("Gate refresh disabled");
        expect(refreshBody.reason).toContain("read-only");
        expect(refreshBody.docs).toContain("ADR-0004-serve-probe-readonly");
        expect(refreshBody.futureOptIn.flag).toBe("--allow-gate-refresh");
      } finally {
        handle.stop();
      }
    });
  });

  test("serves /api/runs/:runId from SQLite index when available", async () => {
    await withTempDir("card-probe-server-runs-", async (dir) => {
      const { ArtifactStore } = await import("../src/lib/artifact-store.ts");
      const store = new ArtifactStore(dir);
      const runId = "run_probe_a";
      const artifactPath = await store.save("bunfig-policy", { status: "pass" }, { runId });
      const relativePath = artifactPath.slice(dir.length + 1);
      await store.saveRunManifest({
        schemaVersion: 1,
        runId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        gates: ["bunfig-policy"],
        artifacts: { "bunfig-policy": relativePath },
        status: "pass",
      });

      const handle = await startProbeServer({
        port: 0,
        probeConfig: { timeoutMs: 100 },
        projectRoot: dir,
      });
      try {
        const res = await fetch(`${handle.url}/api/runs/${runId}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          ok: boolean;
          runId: string;
          indexSource: string;
          artifacts: Array<{ gate: string; path: string; runId?: string | null }>;
        };
        expect(body.ok).toBe(true);
        expect(body.runId).toBe(runId);
        expect(body.indexSource).toBe("sqlite");
        expect(body.artifacts).toHaveLength(1);
        expect(body.artifacts[0]?.gate).toBe("bunfig-policy");
        expect(body.artifacts[0]?.path).toBe(relativePath);
        expect(body.artifacts[0]?.runId).toBe(runId);

        const missing = await fetch(`${handle.url}/api/runs/run_missing`);
        expect(missing.status).toBe(404);
      } finally {
        handle.stop();
      }
    });
  });

  test("refresh response includes artifactPath when saveArtifact is enabled", async () => {
    await withTempDir("card-probe-server-refresh-artifact-", async (dir) => {
      const handle = await startProbeServer({
        port: 0,
        probeConfig: { timeoutMs: 100 },
        projectRoot: dir,
        saveArtifact: true,
      });
      try {
        const refresh = await fetch(`${handle.url}/api/refresh`, { method: "POST" });
        expect(refresh.status).toBe(200);
        const body = (await refresh.json()) as { ok: boolean; artifactPath?: string };
        expect(body.ok).toBe(true);
        expect(body.artifactPath).toContain(join(dir, ".kimi", "artifacts", "card-probe"));
        expect(handle.getLastArtifactPath()).toBe(body.artifactPath);
      } finally {
        handle.stop();
      }
    });
  });

  test("serves index stats and artifact diff routes", async () => {
    await withTempDir("card-probe-server-index-diff-", async (dir) => {
      const { ArtifactStore } = await import("../src/lib/artifact-store.ts");
      const store = new ArtifactStore(dir);
      const pathA = await store.save("lint", { ok: true, n: 1 });
      await Bun.sleep(2);
      const pathB = await store.save("lint", { ok: true, n: 2 });
      const relA = pathA.slice(dir.length + 1);
      const relB = pathB.slice(dir.length + 1);

      const handle = await startProbeServer({
        port: 0,
        probeConfig: { timeoutMs: 100 },
        projectRoot: dir,
      });
      try {
        const statsRes = await fetch(`${handle.url}/api/artifacts/index/stats`);
        expect(statsRes.status).toBe(200);
        const statsBody = (await statsRes.json()) as {
          ok: boolean;
          stats: { totalArtifacts: number; fsArtifactCount: number };
          synced: { rebuilt: boolean; fsCount: number; indexCount: number };
        };
        expect(statsBody.ok).toBe(true);
        expect(statsBody.stats.totalArtifacts).toBe(2);
        expect(statsBody.stats.fsArtifactCount).toBe(2);
        expect(statsBody.synced.indexCount).toBe(2);

        const diffRes = await fetch(
          `${handle.url}/api/artifacts/lint/diff?a=${encodeURIComponent(relA)}&b=${encodeURIComponent(relB)}`
        );
        expect(diffRes.status).toBe(200);
        const diffBody = (await diffRes.json()) as {
          ok: boolean;
          equal: boolean;
          hashA: string;
          hashB: string;
          indexSource: string;
        };
        expect(diffBody.ok).toBe(true);
        expect(diffBody.equal).toBe(false);
        expect(diffBody.indexSource).toBe("sqlite");
        expect(diffBody.hashA).toMatch(/^[a-f0-9]{64}$/);
        expect(diffBody.hashB).toMatch(/^[a-f0-9]{64}$/);

        const badDiff = await fetch(`${handle.url}/api/artifacts/lint/diff?a=${relA}`);
        expect(badDiff.status).toBe(400);

        const feedRes = await fetch(`${handle.url}/api/artifacts/feed.xml`);
        expect(feedRes.status).toBe(200);
        expect(feedRes.headers.get("content-type")).toContain("application/rss+xml");
        const xml = await feedRes.text();
        expect(xml).toContain('<rss version="2.0">');
        expect(xml).toContain("lint");
      } finally {
        handle.stop();
      }
    });
  });

  test("returns JSON 405 with allowed methods", async () => {
    const handle = await startProbeServer({ port: 0, probeConfig: { timeoutMs: 100 } });
    try {
      const cardsPost = await fetch(`${handle.url}/api/cards`, { method: "POST" });
      expect(cardsPost.status).toBe(405);
      const body = (await cardsPost.json()) as {
        ok: boolean;
        error: string;
        allowedMethods: string[];
      };
      expect(body.ok).toBe(false);
      expect(body.error).toBe("Method Not Allowed");
      expect(body.allowedMethods).toEqual(["GET"]);
    } finally {
      handle.stop();
    }
  });

  test("hides /api/effect-benchmark unless effectBenchmark is enabled", async () => {
    const handle = await startProbeServer({ port: 0, probeConfig: { timeoutMs: 100 } });
    try {
      const res = await fetch(`${handle.url}/api/effect-benchmark`);
      expect(res.status).toBe(404);
    } finally {
      handle.stop();
    }
  });

  test(
    "serves BenchmarkApiEnvelope at /api/effect-benchmark when enabled",
    async () => {
      const handle = await startProbeServer({
        port: 0,
        probeConfig: { timeoutMs: 100 },
        effectBenchmark: true,
        effectBenchmarkEnvelope: mockBenchmarkEnvelope(),
      });
      try {
        const res = await fetch(`${handle.url}/api/effect-benchmark`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          schemaVersion: number;
          runner: string;
          summary: { total: number };
          gates: { effectBenchmarkGate: { status: string } };
          configStatus: { tool: string; aligned: boolean };
        };
        expect(body.schemaVersion).toBe(1);
        expect(body.runner).toBe("serve-probe");
        expect(body.summary.total).toBeGreaterThan(0);
        expect(body.gates.effectBenchmarkGate.status).toBeDefined();
        expect(body.configStatus.tool).toBe("config-status");
        expect(body.configStatus.aligned).toBe(true);
      } finally {
        handle.stop();
      }
    },
    { timeout: 30_000 }
  );
});
