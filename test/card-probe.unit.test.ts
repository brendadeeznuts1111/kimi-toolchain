/** @description Card probe helpers and snapshot types. */

import { describe, expect, test } from "bun:test";
import { REPO_ROOT } from "./helpers.ts";
import {
  CARD_PROBE_DECLARED_PORTS,
  cardProbeUnreachableMessage,
  countUnhealthy,
  dashboardStatusToProbe,
  detectProbeEnvironment,
  displayCardId,
  probeAllCards,
  probeConfigStatusCard,
  type CardStatus,
} from "../src/lib/card-probe.ts";

describe("card-probe", () => {
  test("displayCardId strips card- prefix", () => {
    expect(displayCardId("card-trace")).toBe("trace");
    expect(displayCardId("perf")).toBe("perf");
  });

  test("dashboardStatusToProbe maps statuses", () => {
    expect(dashboardStatusToProbe("ok")).toBe("pass");
    expect(dashboardStatusToProbe("pending")).toBe("skip");
    expect(dashboardStatusToProbe("unknown")).toBe("skip");
    expect(dashboardStatusToProbe("error")).toBe("fail");
  });

  test("countUnhealthy counts non-pass non-skip cards", () => {
    const statuses: CardStatus[] = [
      { cardId: "a", source: "examples", status: "pass", lastUpdated: "2024-01-01T00:00:00Z" },
      { cardId: "b", source: "examples", status: "fail", lastUpdated: "2024-01-01T00:00:00Z" },
      { cardId: "c", source: "herdr", status: "skip", lastUpdated: "2024-01-01T00:00:00Z" },
      {
        cardId: "config-status",
        source: "config-status",
        status: "pass",
        lastUpdated: "2024-01-01T00:00:00Z",
      },
    ];
    expect(countUnhealthy(statuses)).toBe(1);
  });

  test("probeConfigStatusCard reflects configuration layer health", async () => {
    const card = await probeConfigStatusCard(REPO_ROOT);
    expect(card.cardId).toBe("config-status");
    expect(card.source).toBe("config-status");
    expect(["pass", "fail"]).toContain(card.status);
    expect(typeof card.lastUpdated).toBe("string");
  }, 10_000);

  test("probeAllCards includes config-status card", async () => {
    const cards = await probeAllCards({ timeoutMs: 100 }, REPO_ROOT);
    const configCard = cards.find((c) => c.cardId === "config-status");
    expect(configCard).toBeDefined();
    expect(configCard?.source).toBe("config-status");
    expect(["pass", "fail", "skip"]).toContain(configCard!.status);
  }, 30_000);

  test("probeAllCards returns skip for dashboards when env vars not set", async () => {
    const cards = await probeAllCards({ timeoutMs: 100 }, REPO_ROOT);
    const examplesCard = cards.find((c) => c.cardId === "examples-dashboard");
    const herdrCard = cards.find((c) => c.cardId === "herdr-dashboard");
    expect(examplesCard).toBeDefined();
    expect(herdrCard).toBeDefined();
    expect(examplesCard!.status).toBe("skip");
    expect(herdrCard!.status).toBe("skip");
    expect(examplesCard!.reason).toBeDefined();
    expect(herdrCard!.reason).toBeDefined();
    expect(examplesCard!.startHint).toBeDefined();
    expect(herdrCard!.startHint).toBeDefined();
  }, 10_000);

  test("detectProbeEnvironment returns idle when no env vars set", () => {
    const env = detectProbeEnvironment();
    expect(env.context).toBe("idle");
    expect(env.examplesExpected).toBe(false);
    expect(env.herdrExpected).toBe(false);
  });

  test("detectProbeEnvironment respects config overrides", () => {
    const env = detectProbeEnvironment({ examplesDashboardUrl: "http://localhost:5678" });
    expect(env.examplesExpected).toBe(true);
    expect(env.context).toBe("dev");
  });

  test("cardProbeUnreachableMessage uses the declared dashboard ports in fallback guidance", () => {
    expect(CARD_PROBE_DECLARED_PORTS.examples).toEqual([5678, 3000, 8080]);
    expect(CARD_PROBE_DECLARED_PORTS.herdr).toEqual([18412]);

    expect(cardProbeUnreachableMessage("examples", {})).toContain(
      `ports ${CARD_PROBE_DECLARED_PORTS.examples.join(", ")}`
    );
    expect(cardProbeUnreachableMessage("herdr", {})).toContain(
      `port ${CARD_PROBE_DECLARED_PORTS.herdr.join(", ")}`
    );
  });
});
