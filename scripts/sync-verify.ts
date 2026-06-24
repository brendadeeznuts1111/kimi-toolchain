#!/usr/bin/env bun
/**
 * Verify repo-managed runtime files match the desktop install.
 */

import { desktopRuntimeDepsOk } from "../src/lib/desktop-runtime-deps.ts";
import { detectSyncDrift } from "../src/lib/sync-hashes.ts";

import { scriptRepoRoot } from "../src/lib/paths.ts";

const REPO_ROOT = scriptRepoRoot();

const report = await detectSyncDrift(REPO_ROOT);
const depsOk = desktopRuntimeDepsOk();

if (report.synced && depsOk) {
  console.log("Desktop runtime is in sync.");
  process.exit(0);
}

if (!depsOk) {
  console.error("Desktop runtime dependencies missing (typescript).");
  console.error("Run: bun run sync");
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
