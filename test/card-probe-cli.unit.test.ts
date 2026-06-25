/** @description Card probe CLI helpers and one-shot probe mode. */

import { describe, expect, test } from "bun:test";
import { buildCardProbeJsonPayload, runCardProbeCli } from "../src/lib/card-probe-cli.ts";
import { summarizeCardStatuses, type CardStatus } from "../src/lib/card-probe.ts";

const sampleStatuses: CardStatus[] = [
  {
    cardId: "a",
    source: "examples",
    status: "pass",
    lastUpdated: "2026-01-01T00:00:00.000Z",
  },
  {
    cardId: "b",
    source: "herdr",
    status: "skip",
    lastUpdated: "2026-01-01T00:00:00.000Z",
    reason: "Herdr not active",
  },
];

/** Spawn-heavy CLI paths need headroom under pre-commit test:changed (1500ms global). */
const SPAWN_TEST_TIMEOUT_MS = 30_000;

describe("card-probe-cli", () => {
  test("summarizeCardStatuses counts pass/fail/skip", () => {
    expect(summarizeCardStatuses(sampleStatuses)).toEqual({
      total: 2,
      pass: 1,
      fail: 0,
      skip: 1,
    });
  });

  test("buildCardProbeJsonPayload includes schemaVersion and summary", () => {
    const payload = buildCardProbeJsonPayload("probe-cards", sampleStatuses);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.tool).toBe("kimi-doctor");
    expect(payload.mode).toBe("probe-cards");
    expect(payload.summary).toEqual({ total: 2, pass: 1, fail: 0, skip: 1 });
    expect(payload.statuses).toEqual(sampleStatuses);
  });

  test(
    "probe-cards returns payload in json mode without strict exit",
    async () => {
      const result = await runCardProbeCli({
        mode: "probe-cards",
        json: true,
        strict: false,
        probeConfig: { timeoutMs: 100 },
      });
      expect(result.payload?.schemaVersion).toBe(1);
      expect(result.payload?.mode).toBe("probe-cards");
      expect(Array.isArray(result.statuses)).toBe(true);
      expect(result.exitCode).toBe(0);
    },
    SPAWN_TEST_TIMEOUT_MS
  );

  test(
    "serve-probe-once warms cache and stops",
    async () => {
      const prevPort = Bun.env.PROBE_SERVER_PORT;
      Bun.env.PROBE_SERVER_PORT = "0";
      try {
        const result = await runCardProbeCli({
          mode: "serve-probe-once",
          json: true,
          probeConfig: { timeoutMs: 100 },
        });
        expect(result.url).toMatch(/^http:\/\//);
        expect(result.payload?.url).toBe(result.url);
        expect((result.payload?.configStatus as { aligned?: boolean } | undefined)?.aligned).toBe(
          true
        );
        expect(Array.isArray(result.statuses)).toBe(true);
        const configStatusCard = result.statuses.find((c) => c.cardId === "config-status");
        expect(configStatusCard).toBeDefined();
        expect(configStatusCard?.source).toBe("config-status");
      } finally {
        if (prevPort === undefined) delete Bun.env.PROBE_SERVER_PORT;
        else Bun.env.PROBE_SERVER_PORT = prevPort;
      }
    },
    SPAWN_TEST_TIMEOUT_MS
  );
});
