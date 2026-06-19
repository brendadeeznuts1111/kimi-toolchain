/** @description Probe cache server routes and lifecycle. */

import { describe, expect, test } from "bun:test";
import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { extractArtifactTimestamp, startProbeServer } from "../src/lib/card-probe-server.ts";
import { withTempDir } from "./helpers.ts";

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
      };
      expect(cardsBody.ok).toBe(true);
      expect(typeof cardsBody.total).toBe("number");
      expect(typeof cardsBody.fetchedAt).toBe("string");
      expect(cardsBody.summary.total).toBe(cardsBody.total);

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
});
