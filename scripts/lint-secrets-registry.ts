#!/usr/bin/env bun
/**
 * Secrets registry lint — SecretKeys ↔ policy ↔ docs parity.
 *
 *   bun run scripts/lint-secrets-registry.ts
 */

import { join } from "path";
import { lintSecretsRegistry } from "../src/lib/secrets-registry-lint.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const issues = await lintSecretsRegistry(REPO_ROOT);
const errors = issues.filter((i) => i.severity === "error");
const warns = issues.filter((i) => i.severity === "warn");

if (errors.length > 0) {
  console.error("lint:secrets-registry failed:\n");
  for (const issue of errors) console.error(`  ✗ ${issue.message}`);
  if (warns.length > 0) {
    console.error("\nWarnings:\n");
    for (const issue of warns) console.error(`  ⚠ ${issue.message}`);
  }
  process.exit(1);
}

for (const issue of warns) console.warn(`  ⚠ ${issue.message}`);
console.log(`lint:secrets-registry OK (${issues.length} issue(s))`);
