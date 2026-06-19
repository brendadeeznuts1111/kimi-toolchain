#!/usr/bin/env bun
/**
 * Verify manifest cursorCanvas pointers and generated canvas companion blocks.
 *
 * Usage:
 *   bun run scripts/lint-cursor-canvas.ts
 */

import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { canvasCompanionsStale } from "../src/lib/canvas-companion-sync.ts";
import { manifestCanvasRoutes } from "../src/lib/canvas-companion-data.ts";
import { LOCAL_DOC_REFERENCES } from "../src/lib/canonical-references.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CANVAS_PREFIX = "docs/canvases/";

function lintManifestPointers(): string[] {
  const violations: string[] = [];

  for (const entry of LOCAL_DOC_REFERENCES) {
    if (!entry.cursorCanvas) continue;

    const { id, cursorCanvas } = entry;

    if (!cursorCanvas.startsWith(CANVAS_PREFIX) || !cursorCanvas.endsWith(".canvas.tsx")) {
      violations.push(
        `${id}: cursorCanvas must be docs/canvases/*.canvas.tsx (got ${cursorCanvas})`
      );
      continue;
    }

    const abs = join(REPO_ROOT, cursorCanvas);
    if (!pathExists(abs)) {
      violations.push(`${id}: missing canvas file ${cursorCanvas}`);
    }
  }

  return violations;
}

async function main(): Promise<void> {
  const violations = [...lintManifestPointers(), ...(await canvasCompanionsStale(REPO_ROOT))];

  if (violations.length > 0) {
    console.error("cursor-canvas lint failed:\n");
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
  }

  const count = manifestCanvasRoutes().length;
  console.log(
    `cursor-canvas OK (${count} pointer${count === 1 ? "" : "s"}, generated routing + hub stats fresh)`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
