#!/usr/bin/env bun
/**
 * Verify repo-managed runtime files match the desktop install.
 */

import { detectSyncDrift } from "../src/lib/sync-hashes.ts";

const REPO_ROOT = import.meta.dir + "/..";

const report = await detectSyncDrift(REPO_ROOT);

if (report.synced) {
  console.log("Desktop runtime is in sync.");
  process.exit(0);
}

if (report.missing.length) {
  console.error("Missing desktop runtime files:");
  for (const file of report.missing) console.error(`  - ${file}`);
}

if (report.drifted.length) {
  console.error("Drifted desktop runtime files:");
  for (const file of report.drifted) console.error(`  - ${file}`);
}

console.error("Run: bun run sync");
process.exit(1);
