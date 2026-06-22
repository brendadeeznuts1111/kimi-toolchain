#!/usr/bin/env bun
/**
 * Feature flags registry lint — constants ↔ docs parity + env usage coverage.
 *
 *   bun run scripts/lint-feature-flags.ts
 */

import { join } from "path";
import { lintFeatureFlagsRegistry } from "../src/lib/feature-flags-registry-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const issues = await lintFeatureFlagsRegistry(REPO_ROOT);
const errors = issues.filter((i) => i.severity === "error");
const warns = issues.filter((i) => i.severity === "warn");

if (errors.length > 0) {
  console.error("lint:feature-flags failed:\n");
  for (const issue of errors) console.error(`  ✗ ${issue.message}`);
  if (warns.length > 0) {
    console.error("\nWarnings:\n");
    for (const issue of warns) console.error(`  ⚠ ${issue.message}`);
  }
  process.exit(1);
}

for (const issue of warns) console.warn(`  ⚠ ${issue.message}`);
console.log(`lint:feature-flags OK (${issues.length} issue(s))`);
