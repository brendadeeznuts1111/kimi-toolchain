import { describe, expect, test } from "bun:test";
import { join } from "path";
import { makeDir, writeText } from "../src/lib/bun-io.ts";
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
import { cleanupPath, readText, REPO_ROOT, testTempDir } from "./helpers.ts";

async function createMinimalCanvasProject(): Promise<string> {
  const dir = testTempDir("canvas-sync-");
  const canvasesDir = join(dir, "docs/canvases");
  await makeDir(canvasesDir, { recursive: true });
  await makeDir(join(dir, "src/lib"), { recursive: true });

  for (const file of [
    "kimi-toolchain.canvas.tsx",
    "herdr-dashboard-thumbnails.canvas.tsx",
    "namespace-boundaries.canvas.tsx",
  ]) {
    await Bun.write(
      join(canvasesDir, file),
      await Bun.file(join(REPO_ROOT, "docs/canvases", file)).text()
    );
  }

  await writeText(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "kimi-canvas-test",
        version: "1.0.0",
        bin: {
          "kimi-doctor": "src/bin/kimi-doctor.ts",
          "kimi-governance": "src/bin/kimi-governance.ts",
        },
      },
      null,
      2
    )
  );

  await writeText(join(dir, "src/lib/a.ts"), "export const a = 1;\n");
  await writeText(join(dir, "src/lib/b.ts"), "export const b = 2;\n");

  return dir;
}

describe("cursor-canvas-lint", () => {
  test("manifestCanvasRoutes lists manifest-backed canvases", () => {
    const routes = manifestCanvasRoutes();
    expect(routes).toHaveLength(11);
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
    expect(block).toContain("kimi-contract");
    expect(block).toContain("kimi-capabilities");
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
    expect(extractCanvasRoutingIds(automation)).toHaveLength(11);
  });

  test("canvasCompanionsStale is clean after sync", async () => {
    const projectDir = await createMinimalCanvasProject();
    try {
      await syncCanvasCompanions(projectDir);
      expect(await canvasCompanionsStale(projectDir)).toEqual([]);
    } finally {
      cleanupPath(projectDir);
    }
  }, 10_000);

  test("hub canvas unit count matches test-gates", async () => {
    const hub = await readText(join(REPO_ROOT, "docs/canvases/kimi-toolchain.canvas.tsx"));
    expect(hub).toContain(`const UNIT_COUNT = ${UNIT_TEST_FILES.length};`);
  });
});
