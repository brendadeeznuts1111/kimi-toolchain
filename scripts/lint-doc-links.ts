#!/usr/bin/env bun
/**
 * Lint inline @see / help URLs — prefer bun.com deep links and shared BUN_*_DOC_URL constants.
 */

import { join } from "path";
import { formatDocLinkViolation, lintDocLinks } from "../src/lib/doc-links-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function main(): Promise<void> {
  const fileArgs = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const violations = await lintDocLinks(REPO_ROOT, fileArgs.length > 0 ? fileArgs : undefined);

  if (violations.length > 0) {
    console.error("✗ Doc link violations found:\n");
    for (const v of violations) console.error(`  ${formatDocLinkViolation(v)}\n`);
    process.exit(1);
  }

  console.log("  ✓ Doc links OK");
}

main().catch((err) => {
  console.error("lint-doc-links failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
