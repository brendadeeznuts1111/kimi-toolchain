import { describe, expect, test } from "bun:test";
import {
  buildDashboardCardRegistry,
  cardStatusFromProbe,
  fetchDashboardCardsPayload,
  influencesForManifest,
  lintCanvasInfluences,
  parseDashboardCardsFromHtml,
  resolveCanvasFilter,
} from "../src/lib/dashboard-card-registry.ts";
import { fetchDashboardCanvases } from "../src/lib/herdr-dashboard-data.ts";
import { LOCAL_DOC_REFERENCES } from "../src/lib/canonical-references.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("dashboard-card-registry", () => {
  test("parseDashboardCardsFromHtml extracts card ids and api routes", () => {
    const html = `
      <div class="card" id="card-gates"><h2>Gate Health</h2></div>
      <script>
      (async () => {
        const d = await fetchJson("/api/gates");
        card("card-gates", "ok");
      })();
      </script>`;
    const cards = parseDashboardCardsFromHtml(html);
    expect(cards.length).toBe(1);
    expect(cards[0].id).toBe("card-gates");
    expect(cards[0].apiRoute).toBe("/api/gates");
  });

  test("loadDashboardCardRegistry matches dashboard.html card count", () => {
    const registry = buildDashboardCardRegistry(REPO_ROOT);
    expect(registry.length).toBe(65);
    expect(registry.some((c) => c.id === "card-kimi-doctor")).toBe(true);
  });

  test("lintCanvasInfluences passes for all manifest canvas rows", () => {
    expect(lintCanvasInfluences(REPO_ROOT)).toEqual([]);
    const withCanvas = LOCAL_DOC_REFERENCES.filter((r) => r.cursorCanvas);
    const withInfluences = LOCAL_DOC_REFERENCES.filter((r) => r.canvasInfluences?.length);
    expect(withInfluences.length).toBe(withCanvas.length);
  });

  test("resolveCanvasFilter accepts manifest id and canvasId", () => {
    expect(resolveCanvasFilter("deep-quality").manifestId).toBe("deep-quality");
    expect(resolveCanvasFilter("kimi-heal-doctor-scaffold").manifestId).toBe("deep-quality");
    expect(influencesForManifest("templates")).toContain("card-scaffold");
  });

  test("fetchDashboardCanvases exposes influences", () => {
    const payload = fetchDashboardCanvases();
    const templates = payload.canvases.find((c) => c.id === "templates");
    expect(templates?.influences).toContain("card-kimi-doctor");
  });

  test("cardStatusFromProbe maps hub card payloads", () => {
    expect(cardStatusFromProbe("card-gates", { summary: { ok: true } })).toBe("ok");
    expect(cardStatusFromProbe("card-gates", { summary: { ok: false } })).toBe("error");
    expect(cardStatusFromProbe("card-perf-harness", { allPass: true })).toBe("ok");
    expect(cardStatusFromProbe("card-perf-harness", { allPass: false })).toBe("error");
    expect(cardStatusFromProbe("card-effect-benchmark", { allPass: true })).toBe("ok");
    expect(cardStatusFromProbe("card-effect-benchmark", { allPass: false })).toBe("error");
    expect(cardStatusFromProbe("card-effect-benchmark", {})).toBe("unknown");
    expect(cardStatusFromProbe("card-kimi-doctor", { commands: [{ flag: "--train" }] })).toBe("ok");
    expect(cardStatusFromProbe("card-scaffold", { architecture: {}, scripts: {} })).toBe("ok");
    expect(
      cardStatusFromProbe("card-symbols", { symbols: { domain: [{ key: "kimi.trace" }] } })
    ).toBe("ok");
    expect(cardStatusFromProbe("card-gates", undefined)).toBe("unknown");
  });

  test("fetchDashboardCardsPayload applies hub probes", async () => {
    const payload = await fetchDashboardCardsPayload(REPO_ROOT, {
      probes: {
        "card-gates": { summary: { ok: true } },
        "card-perf-registry": { allPass: false },
      },
    });
    const gates = payload.cards.find((c) => c.id === "card-gates");
    const perf = payload.cards.find((c) => c.id === "card-perf-registry");
    const orphan = payload.cards.find((c) => c.id === "card-color");
    expect(gates?.status).toBe("ok");
    expect(perf?.status).toBe("error");
    expect(orphan?.status).toBe("unknown");
  });
});
