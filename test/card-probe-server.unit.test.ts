/** @description Probe cache server routes and lifecycle. */

import { describe, expect, test } from "bun:test";
import { startProbeServer } from "../src/lib/card-probe-server.ts";

describe("card-probe-server", () => {
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
