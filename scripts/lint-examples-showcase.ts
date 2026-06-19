#!/usr/bin/env bun
/**
 * Verify examples showcase cardIds resolve to dashboard.html card panels.
 *
 * Usage:
 *   bun run scripts/lint-examples-showcase.ts
 */

import { join } from "path";
import {
  SHOWCASE_ENTRIES,
  buildCardShowcaseIndex,
  lintShowcaseCardIds,
} from "../src/lib/examples-showcase.ts";

const REPO_ROOT = join(import.meta.dir, "..");

function main(): void {
  const violations = lintShowcaseCardIds(REPO_ROOT);
  if (violations.length > 0) {
    console.error("examples-showcase lint failed:\n");
    for (const line of violations) console.error(`  ${line}`);
    process.exit(1);
  }

  const index = buildCardShowcaseIndex();
  const mappedCards = Object.keys(index).length;
  console.log(
    `examples-showcase OK (${SHOWCASE_ENTRIES.length} entries, ${mappedCards} cards indexed)`
  );
}

main();
