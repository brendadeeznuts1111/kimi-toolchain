#!/usr/bin/env bun
/**
 * Unified registry lint runner.
 *
 * Replaces the three near-identical wrapper scripts for error, feature-flag,
 * and secrets registries.
 *
 * Usage:
 *   bun run scripts/lint-registry.ts
 *   bun run scripts/lint-registry.ts --error
 *   bun run scripts/lint-registry.ts --feature
 *   bun run scripts/lint-registry.ts --secret
 */

import { lintErrorRegistry } from "../src/lib/error-registry-lint.ts";
import { lintFeatureFlagsRegistry } from "../src/lib/feature-flags-registry-lint.ts";
import { lintSecretsRegistry } from "../src/lib/secrets-registry-lint.ts";

const REPO_ROOT = import.meta.dir.replace(/\/scripts$/, "");

interface RegistryLintIssue {
  severity: "error" | "warn";
  message: string;
}

interface Registry {
  name: string;
  run: () => RegistryLintIssue[] | Promise<RegistryLintIssue[]>;
}

const registries: Registry[] = [
  { name: "error-registry", run: () => lintErrorRegistry(REPO_ROOT) },
  { name: "feature-flags", run: () => lintFeatureFlagsRegistry(REPO_ROOT) },
  { name: "secrets-registry", run: () => lintSecretsRegistry(REPO_ROOT) },
];

const selected = new Set<string>();
if (Bun.argv.includes("--error")) selected.add("error-registry");
if (Bun.argv.includes("--feature")) selected.add("feature-flags");
if (Bun.argv.includes("--secret")) selected.add("secrets-registry");
if (selected.size === 0) {
  for (const registry of registries) selected.add(registry.name);
}

let totalErrors = 0;
let totalWarnings = 0;
let failed = false;

for (const registry of registries) {
  if (!selected.has(registry.name)) continue;

  const issues = await registry.run();
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warn");

  totalErrors += errors.length;
  totalWarnings += warnings.length;

  if (errors.length > 0) {
    console.error(`lint:${registry.name} failed:`);
    for (const issue of errors) console.error(`  ✗ ${issue.message}`);
    if (warnings.length > 0) {
      console.error("\nWarnings:");
      for (const issue of warnings) console.error(`  ⚠ ${issue.message}`);
    }
    failed = true;
    continue;
  }

  for (const issue of warnings) console.warn(`  ⚠ ${issue.message}`);
  console.log(`lint:${registry.name} OK (${issues.length} issue(s))`);
}

if (failed) {
  process.exit(1);
}

const scope = selected.size === registries.length ? "all" : `${selected.size} selected`;
console.log(`lint:registry OK (${scope}, ${totalErrors} errors, ${totalWarnings} warnings)`);
