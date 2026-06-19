import { describe, expect, test } from "bun:test";
import {
  buildDashboardCardRegistry,
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
    expect(registry.length).toBe(64);
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

  test("v53-architecture includes dashboard-card-registry cursorCanvas pointer", () => {
    const entry = LOCAL_DOC_REFERENCES.find((ref) => ref.id === "v53-architecture");
    expect(entry?.cursorCanvas).toBe("docs/canvases/dashboard-card-registry.canvas.tsx");
    expect(entry?.canvasInfluences).toContain("card-gates");
    expect(influencesForManifest("v53-architecture")).toContain("card-kimi-doctor");
  });

  test("fetchDashboardCanvases exposes influences", () => {
    const payload = fetchDashboardCanvases();
    const templates = payload.canvases.find((c) => c.id === "templates");
    expect(templates?.influences).toContain("card-kimi-doctor");
  });
});
