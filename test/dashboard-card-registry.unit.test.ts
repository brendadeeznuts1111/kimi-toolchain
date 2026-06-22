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
        const art = await fetchJson("/api/artifacts?includeLineage=1");
        card("card-gates", "ok");
      })();
      </script>`;
    const cards = parseDashboardCardsFromHtml(html);
    expect(cards.length).toBe(1);
    expect(cards[0].id).toBe("card-gates");
    expect(cards[0].apiRoute).toBe("/api/gates");
  });

  test("parseDashboardCardsFromHtml reads routes from external dashboard.js script source", async () => {
    const html = await Bun.file(`${REPO_ROOT}/examples/dashboard/src/dashboard.html`).text();
    const script = await Bun.file(`${REPO_ROOT}/examples/dashboard/src/dashboard.js`).text();
    const cards = parseDashboardCardsFromHtml(html, { script });
    const convergence = cards.find((c) => c.id === "card-convergence");
    const markdown = cards.find((c) => c.id === "card-markdown");
    expect(convergence?.apiRoute).toBe("/api/artifact-graph");
    expect(markdown?.apiRoute).toBe("/api/markdown/html");
  });

  test("parseDashboardCardsFromHtml scopes fetches to enclosing IIFE", () => {
    const html = `
      <div class="card" id="card-build"><h2>Build</h2></div>
      <div class="card" id="card-depth"><h2>Depth</h2></div>
      <script>
      (async () => {
        await fetch("/api/markdown/html");
        card("card-markdown", "x");
      })();
      (async () => {
        const d = await fetchJson("/api/build-info");
        card("card-build", "ok");
      })();
      (async () => {
        const d = await fetchJson("/api/console-depth");
        await fetch("/api/inspect-simple");
        card("card-depth", "ok");
      })();
      </script>`;
    const cards = parseDashboardCardsFromHtml(html);
    expect(cards.find((c) => c.id === "card-build")?.apiRoute).toBe("/api/build-info");
    expect(cards.find((c) => c.id === "card-depth")?.apiRoute).toBe("/api/console-depth");
  });

  test("loadDashboardCardRegistry matches dashboard.html card count", () => {
    const registry = buildDashboardCardRegistry(REPO_ROOT);
    expect(registry.length).toBe(79);
    expect(registry.some((c) => c.id === "card-kimi-doctor")).toBe(true);
    expect(registry.some((c) => c.id === "card-config-status")).toBe(true);
  });

  test("lintCanvasInfluences passes for all manifest canvas rows", () => {
    expect(lintCanvasInfluences(REPO_ROOT)).toEqual([]);
    const withCanvas = LOCAL_DOC_REFERENCES.filter((r) => r.cursorCanvas);
    const withInfluences = LOCAL_DOC_REFERENCES.filter((r) => r.canvasInfluences?.length);
    expect(withInfluences.length).toBe(withCanvas.length);
  });

  test("resolveCanvasFilter accepts manifest id and canvasId", () => {
    expect(resolveCanvasFilter("deep-quality").manifestId).toBe("deep-quality");
    expect(resolveCanvasFilter("deep-quality").recognized).toBe(true);
    expect(resolveCanvasFilter("kimi-heal-doctor-scaffold").manifestId).toBe("deep-quality");
    expect(resolveCanvasFilter("kimi-heal-doctor-scaffold").recognized).toBe(true);
    expect(resolveCanvasFilter("not-a-canvas").recognized).toBe(false);
    expect(resolveCanvasFilter("not-a-canvas").manifestId).toBeNull();
    expect(influencesForManifest("templates")).toContain("card-scaffold");
    expect(influencesForManifest("artifact-lineage")).toContain("card-artifacts");
    expect(influencesForManifest("artifact-lineage")).toContain("card-bunfig-policy");
    expect(influencesForManifest("artifact-lineage")).toContain("card-url");
  });

  test("card-artifacts registry route is explicit /api/artifacts", () => {
    const registry = buildDashboardCardRegistry(REPO_ROOT);
    const artifacts = registry.find((c) => c.id === "card-artifacts");
    expect(artifacts?.apiRoute).toBe("/api/artifacts");
    expect(artifacts?.influencedBy).toContain("artifact-lineage");
  });

  test("buildDashboardCardRegistry resolves primary routes for hub and depth cards", () => {
    const registry = buildDashboardCardRegistry(REPO_ROOT);
    expect(registry.find((c) => c.id === "card-gates")?.apiRoute).toBe("/api/gates");
    expect(registry.find((c) => c.id === "card-build")?.apiRoute).toBe("/api/build-info");
    expect(registry.find((c) => c.id === "card-depth")?.apiRoute).toBe("/api/console-depth");
    expect(registry.find((c) => c.id === "card-semver")?.apiRoute).toBe("/api/semver");
    expect(registry.find((c) => c.id === "card-config-status")?.apiRoute).toBe(
      "/api/config-status"
    );
    expect(registry.find((c) => c.id === "card-bun-runtime")?.apiRoute).toBe("/api/bun-runtime");
    expect(registry.find((c) => c.id === "card-bun-pm")?.apiRoute).toBe("/api/bun-pm");
  });

  test("fetchDashboardCardsPayload ignores unrecognized canvas query", async () => {
    const all = await fetchDashboardCardsPayload(REPO_ROOT, {});
    const unknown = await fetchDashboardCardsPayload(REPO_ROOT, { canvas: "nonexistent-canvas" });
    expect(unknown.total).toBe(79);
    expect(unknown.filter.recognized).toBe(false);
    expect(unknown.filter.manifestId).toBeNull();
    expect(unknown.cards.map((c) => c.id).sort()).toEqual(all.cards.map((c) => c.id).sort());
  });

  test("fetchDashboardCanvases exposes influences", async () => {
    const payload = await fetchDashboardCanvases();
    const templates = payload.canvases.find((c) => c.id === "templates");
    expect(templates?.influences).toContain("card-kimi-doctor");
    const lineage = payload.canvases.find((c) => c.id === "artifact-lineage");
    expect(lineage?.influences).toContain("card-artifacts");
  });

  test("fetchDashboardCardsPayload filters artifact-lineage canvas to influenced cards", async () => {
    const payload = await fetchDashboardCardsPayload(REPO_ROOT, {
      canvas: "artifact-lineage",
    });
    const ids = payload.cards.map((c) => c.id);
    expect(ids).toContain("card-artifacts");
    expect(ids).toContain("card-gates");
    expect(ids).toContain("card-bunfig-policy");
    expect(ids).toContain("card-url");
    expect(ids).not.toContain("card-color");
    expect(payload.filter.manifestId).toBe("artifact-lineage");
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
    expect(
      cardStatusFromProbe("card-kimi-doctor", {
        live: { perf: { allPass: true }, artifacts: { savedCount: 2 }, ok: true },
        ok: true,
      })
    ).toBe("ok");
    expect(
      cardStatusFromProbe("card-kimi-doctor", {
        live: { perf: { allPass: false }, artifacts: { savedCount: 1 } },
        allPass: false,
      })
    ).toBe("error");
    expect(
      cardStatusFromProbe("card-kimi-doctor", {
        live: { perf: { allPass: true }, artifacts: { savedCount: 0 } },
      })
    ).toBe("warn");
    expect(
      cardStatusFromProbe("card-kimi-doctor", {
        live: { perf: { allPass: true }, artifacts: { savedCount: 2 }, effectGates: { ok: false } },
      })
    ).toBe("error");
    expect(
      cardStatusFromProbe("card-scaffold", {
        architecture: {},
        scripts: {},
        templatePolicy: { layers: 29 },
        bootstrapPaths: [{}],
      })
    ).toBe("ok");
    expect(cardStatusFromProbe("card-scaffold", { architecture: {}, scripts: {} })).toBe("warn");
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

  test("fetchDashboardCardsPayload applies route probe envelopes", async () => {
    const payload = await fetchDashboardCardsPayload(REPO_ROOT, {
      probes: {
        "card-color": { statusCode: 200, body: { note: "ok" } },
        "card-console": { statusCode: 503, body: { error: "down" } },
      },
    });
    const color = payload.cards.find((c) => c.id === "card-color");
    const consoleCard = payload.cards.find((c) => c.id === "card-console");
    expect(color?.status).toBe("ok");
    expect(consoleCard?.status).toBe("error");
  });

  test("fetchDashboardCardsPayload orphans filter returns canvas-unlinked cards only", async () => {
    const all = buildDashboardCardRegistry(REPO_ROOT);
    const linked = all.filter((c) => c.influencedBy.length > 0).length;
    const orphanCount = all.length - linked;

    const payload = await fetchDashboardCardsPayload(REPO_ROOT, { orphans: true });
    expect(payload.filter.orphans).toBe(true);
    expect(payload.total).toBe(orphanCount);
    expect(payload.cards.every((c) => c.influencedBy.length === 0)).toBe(true);
    expect(payload.cards.some((c) => c.id === "card-color")).toBe(true);
    expect(payload.cards.some((c) => c.id === "card-artifacts")).toBe(false);
  });

  test("fetchDashboardCardsPayload attaches showcaseEntries reverse map", async () => {
    const payload = await fetchDashboardCardsPayload(REPO_ROOT, {});
    const artifacts = payload.cards.find((c) => c.id === "card-artifacts");
    const gates = payload.cards.find((c) => c.id === "card-gates");
    expect(artifacts?.showcaseEntries).toContain("trading-workspace");
    expect(gates?.showcaseEntries).toContain("dashboard");
  });
});
