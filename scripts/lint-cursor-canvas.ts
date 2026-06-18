#!/usr/bin/env bun
/**
 * Verify localDocs cursorCanvas pointers resolve to repo files under docs/canvases/.
 *
 * Usage:
 *   bun run scripts/lint-cursor-canvas.ts
 */

import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { LOCAL_DOC_REFERENCES } from "../src/lib/canonical-references.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const CANVAS_PREFIX = "docs/canvases/";

function main(): void {
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

  if (violations.length > 0) {
    console.error("cursorCanvas lint failed:\n");
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
  }

  const count = LOCAL_DOC_REFERENCES.filter((e) => e.cursorCanvas).length;
  console.log(`cursor-canvas OK (${count} pointer${count === 1 ? "" : "s"})`);
}

main();
