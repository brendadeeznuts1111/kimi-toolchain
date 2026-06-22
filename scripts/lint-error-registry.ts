#!/usr/bin/env bun
/**
 * Error domain registry lint — constants ↔ docs parity.
 *
 *   bun run scripts/lint-error-registry.ts
 */

import { join } from "path";
import { lintErrorRegistry } from "../src/lib/error-registry-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const issues = lintErrorRegistry(REPO_ROOT);
const errors = issues.filter((i) => i.severity === "error");
const warns = issues.filter((i) => i.severity === "warn");

if (errors.length > 0) {
  console.error("lint:error-registry failed:\n");
  for (const issue of errors) console.error(`  ✗ ${issue.message}`);
  if (warns.length > 0) {
    console.error("\nWarnings:\n");
    for (const issue of warns) console.error(`  ⚠ ${issue.message}`);
  }
  process.exit(1);
}

for (const issue of warns) console.warn(`  ⚠ ${issue.message}`);
console.log(`lint:error-registry OK (${issues.length} issue(s))`);
