import { describe, expect, test } from "bun:test";
import {
  SHOWCASE_ENTRIES,
  buildCardShowcaseIndex,
  buildExamplesShowcasePayload,
  entriesForCard,
  entriesForLane,
  getShowcaseEntry,
  lintShowcaseCardIds,
  probeTradingWorkspace,
} from "../src/lib/examples-showcase.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("examples-showcase", () => {
  test("registry has four runnable projects and eleven guides", () => {
    const projects = SHOWCASE_ENTRIES.filter((e) => e.kind === "project");
    const guides = SHOWCASE_ENTRIES.filter((e) => e.kind === "guide");
    expect(projects.length).toBe(4);
    expect(guides.length).toBe(11);
    expect(projects.map((p) => p.id).sort()).toEqual([
      "dashboard",
      "gates",
      "portal",
      "trading-workspace",
    ]);
  });

  test("buildExamplesShowcasePayload marks projects present and runnable", () => {
    const payload = buildExamplesShowcasePayload(REPO_ROOT);
    expect(payload.ok).toBe(true);
    expect(payload.schemaVersion).toBe(1);
    expect(payload.totals.projects).toBe(4);
    expect(payload.totals.guides).toBe(11);
    expect(payload.totals.cardsMapped).toBeGreaterThan(10);

    const dashboard = payload.entries.find((e) => e.id === "dashboard");
    const portal = payload.entries.find((e) => e.id === "portal");
    const trading = payload.entries.find((e) => e.id === "trading-workspace");
    const gates = payload.entries.find((e) => e.id === "gates");
    expect(dashboard?.status.present).toBe(true);
    expect(dashboard?.status.runnable).toBe(true);
    expect(portal?.status.present).toBe(true);
    expect(portal?.status.runnable).toBe(true);
    expect(trading?.status.present).toBe(true);
    expect(trading?.status.runnable).toBe(true);
    expect(gates?.status.present).toBe(true);
    expect(gates?.status.runnable).toBe(true);
  });

  test("lintShowcaseCardIds resolves every mapped card in dashboard.html", () => {
    expect(lintShowcaseCardIds(REPO_ROOT)).toEqual([]);
  });

  test("entriesForCard links card-artifacts to runtime and control-plane entries", () => {
    const linked = entriesForCard("card-artifacts").map((e) => e.id);
    expect(linked).toContain("dashboard");
    expect(linked).toContain("trading-workspace");
    expect(linked).toContain("control-plane-layers");
  });

  test("entriesForLane returns ordered runtime projects first", () => {
    const runtime = entriesForLane("runtime").filter((e) => e.kind === "project");
    expect(runtime[0]?.id).toBe("dashboard");
    expect(runtime[1]?.id).toBe("portal");
    expect(runtime[2]?.id).toBe("trading-workspace");
    expect(runtime[3]?.id).toBe("gates");
  });

  test("getShowcaseEntry returns trading persona metadata", () => {
    const trading = getShowcaseEntry("trading-workspace");
    expect(trading?.persona).toContain("Alex");
    expect(trading?.controlPlaneLevel).toBe(2);
  });

  test("buildCardShowcaseIndex maps card-artifacts to multiple entries", () => {
    const index = buildCardShowcaseIndex();
    expect(index["card-artifacts"]).toContain("dashboard");
    expect(index["card-artifacts"]).toContain("trading-workspace");
    expect(index["card-gates"]?.length).toBeGreaterThan(3);
  });

  test("buildExamplesShowcasePayload includes probes and cardIndex", () => {
    const payload = buildExamplesShowcasePayload(REPO_ROOT);
    expect(payload.cardIndex["card-perf-harness"]).toContain("platform-absorption");
    const trading = payload.entries.find((e) => e.id === "trading-workspace");
    expect(trading?.probe?.artifactCount).toBeGreaterThan(0);
    const dashboard = payload.entries.find((e) => e.id === "dashboard");
    expect(dashboard?.probe && "cardCount" in dashboard.probe ? dashboard.probe.cardCount : 0).toBe(
      70
    );
  });

  test("buildExamplesShowcasePayload rewrites open commands to settings port", () => {
    const payload = buildExamplesShowcasePayload(REPO_ROOT, {
      settings: {
        port: 5678,
        probePort: 5678,
        probeHost: "127.0.0.1",
        canonicalPort: 5678,
        dashboardUrl: "http://127.0.0.1:5678/",
      },
    });
    const dashboard = payload.entries.find((e) => e.id === "dashboard");
    expect(dashboard?.commands.some((c) => c.includes("127.0.0.1:5678"))).toBe(true);
    expect(dashboard?.commands.some((c) => c.includes(":3000"))).toBe(false);
    expect(payload.settings.port).toBe(5678);
  });

  test("buildExamplesShowcasePayload filters by id", () => {
    const payload = buildExamplesShowcasePayload(REPO_ROOT, { id: "image-effect" });
    expect(payload.entries.length).toBe(1);
    expect(payload.filter.id).toBe("image-effect");
    expect(payload.filter.example).toBe("image-effect");
  });

  test("probeTradingWorkspace reads var/trading-artifacts", () => {
    const probe = probeTradingWorkspace(REPO_ROOT);
    expect(probe.ok).toBe(true);
    expect(probe.gateCount).toBeGreaterThan(0);
    expect(probe.artifactCount).toBeGreaterThan(0);
  });
});
