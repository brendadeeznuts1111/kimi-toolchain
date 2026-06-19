import { describe, expect, test } from "bun:test";
import { join } from "path";
import {
  HUB_BIN_CATEGORY,
  listPackageBinNames,
  manifestCanvasRoutes,
  manifestLocalDocsRows,
  renderSimpleCanvasRoutingBlock,
  renderToolInventoryBlock,
  routingRowTones,
  uncategorizedPackageBins,
} from "../src/lib/canvas-companion-data.ts";
import { canvasCompanionsStale, syncCanvasCompanions } from "../src/lib/canvas-companion-sync.ts";
import { extractCanvasRoutingIds } from "../src/lib/cursor-canvas-lint.ts";
import { UNIT_TEST_FILES } from "../src/lib/test-gates.ts";
import { REPO_ROOT, readText } from "./helpers.ts";

describe("cursor-canvas-lint", () => {
  test("manifestCanvasRoutes lists nine manifest-backed canvases", () => {
    const routes = manifestCanvasRoutes();
    expect(routes).toHaveLength(9);
    expect(routes.map((r) => r.canvasId)).toContain("herdr-dashboard-automation");
  });

  test("every package.json bin is categorized for hub inventory", async () => {
    const binNames = await listPackageBinNames(REPO_ROOT);
    expect(uncategorizedPackageBins(binNames)).toEqual([]);
    expect(Object.keys(HUB_BIN_CATEGORY).length).toBeGreaterThanOrEqual(binNames.length);
  });

  test("renderToolInventoryBlock lists every bin once", async () => {
    const binNames = await listPackageBinNames(REPO_ROOT);
    const block = renderToolInventoryBlock(binNames);
    for (const name of binNames) {
      expect(block).toContain(name);
    }
    expect(block).toContain("kimi-bake");
    expect(block).toContain("kimi-dashboard");
  });

  test("renderSimpleCanvasRoutingBlock marks the active canvas", () => {
    const block = renderSimpleCanvasRoutingBlock("herdr-dashboard-automation");
    expect(block).toContain("manifest id kimi-doctor (this canvas)");
    expect(block).toContain("kimi-toolchain.canvas.tsx");
  });

  test("routingRowTones length matches manifest canvas count", () => {
    const routes = manifestCanvasRoutes();
    expect(routingRowTones("kimi-fix")).toHaveLength(routes.length);
    expect(routingRowTones("kimi-toolchain")).toHaveLength(routes.length);
  });

  test("manifestLocalDocsRows includes socket saturation and v53 architecture", () => {
    const rows = manifestLocalDocsRows();
    const ids = rows.map((row) => row.id);
    expect(ids).toContain("herdr-socket-saturation-protocol");
    expect(ids).toContain("v53-architecture");
    expect(rows.length).toBeGreaterThan(15);
  });

  test("thumbnails canvas lists generated manifest localDocs", async () => {
    const thumbnails = await readText(
      join(REPO_ROOT, "docs/canvases/herdr-dashboard-thumbnails.canvas.tsx")
    );
    expect(thumbnails).toContain("@generated manifest-local-docs");
    expect(thumbnails).toContain("herdr-socket-saturation-protocol");
    expect(thumbnails).toContain("v53-architecture");
  });

  test("extractCanvasRoutingIds parses generated blocks", async () => {
    const automation = await readText(
      join(REPO_ROOT, "docs/canvases/herdr-dashboard-automation.canvas.tsx")
    );
    expect(extractCanvasRoutingIds(automation)).toHaveLength(9);
  });

  test("canvasCompanionsStale is clean after sync", async () => {
    await syncCanvasCompanions(REPO_ROOT);
    expect(await canvasCompanionsStale(REPO_ROOT)).toEqual([]);
  });

  test("hub canvas unit count matches test-gates", async () => {
    const hub = await readText(join(REPO_ROOT, "docs/canvases/kimi-toolchain.canvas.tsx"));
    expect(hub).toContain(`const UNIT_COUNT = ${UNIT_TEST_FILES.length};`);
  });
});
