#!/usr/bin/env bun
/**
 * Generate CANVAS_ROUTING, TOOL_INVENTORY, and kimi-toolchain hub stats from manifest SSOT.
 *
 * Usage:
 *   bun run canvas:generate
 *   bun run canvas:generate --check
 */

import { join } from "path";
import { canvasCompanionsStale, syncCanvasCompanions } from "../src/lib/canvas-companion-sync.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");

  if (check) {
    const violations = await canvasCompanionsStale(REPO_ROOT);
    if (violations.length > 0) {
      console.error("canvas companions stale:\n");
      for (const line of violations) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log("canvas companions OK");
    return;
  }

  const result = await syncCanvasCompanions(REPO_ROOT);
  if (result.updated.length === 0) {
    console.log("canvas companions OK (no changes)");
    return;
  }
  console.log(`canvas:generate updated ${result.updated.length} file(s):`);
  for (const path of result.updated) console.log(`  ${path}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
