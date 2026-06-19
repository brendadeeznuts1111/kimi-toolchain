#!/usr/bin/env bun
/**
 * Verify canvasInfluences on LOCAL_DOC_REFERENCES resolve to dashboard.html card ids.
 *
 * Usage:
 *   bun run scripts/lint-canvas-influences.ts
 */

import { join } from "path";
import { lintCanvasInfluences, loadDashboardCardIds } from "../src/lib/dashboard-card-registry.ts";
import { LOCAL_DOC_REFERENCES } from "../src/lib/canonical-references.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function main(): void {
  const violations = lintCanvasInfluences(REPO_ROOT);
  if (violations.length > 0) {
    console.error("canvasInfluences lint failed:\n");
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
  }

  const withInfluences = LOCAL_DOC_REFERENCES.filter((e) => e.canvasInfluences?.length).length;
  const cardCount = loadDashboardCardIds(REPO_ROOT).length;
  console.log(
    `canvas-influences OK (${withInfluences} canvas row${withInfluences === 1 ? "" : "s"}, ${cardCount} cards)`
  );
}

main();
