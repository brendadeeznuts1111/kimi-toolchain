#!/usr/bin/env bun
/**
 * Scoped lint for check:fast --changed-only — oxlint plus fast file-local hook checks.
 */

import { join } from "path";
import { pathExists } from "../src/lib/bun-io.ts";
import { filterLintPaths } from "../src/lib/check-changed.ts";
import {
  filterBannedTermPaths,
  filterChangedTestPaths,
  filterPatternPaths,
  printScopedLintNotice,
} from "../src/lib/check-lint-scoped.ts";
import { lintBannedTerms } from "./lint-banned-terms.ts";
import { lintPatternViolations } from "./lint-patterns.ts";
import { lintTestNames } from "./lint-test-names.ts";

const REPO_ROOT = join(import.meta.dir, "..");

async function runOxlint(paths: string[]): Promise<number> {
  const proc = Bun.spawn(["oxlint", ...paths], {
    cwd: REPO_ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

async function main(): Promise<void> {
  const changed = Bun.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  if (changed.length === 0) {
    console.error("lint-changed: no files provided");
    process.exit(1);
  }

  printScopedLintNotice();

  const oxlintPaths = filterLintPaths(changed);
  if (oxlintPaths.length > 0) {
    const code = await runOxlint(oxlintPaths);
    if (code !== 0) process.exit(code);
  }

  const bannedPaths = filterBannedTermPaths(changed);
  const bannedViolations = await lintBannedTerms(REPO_ROOT, bannedPaths);
  if (bannedViolations.length > 0) {
    console.error("✗ Banned terms found:\n");
    for (const v of bannedViolations) console.error(`  ${v}\n`);
    process.exit(1);
  }
  if (bannedPaths.length > 0) console.log("  ✓ No banned terms");

  const patternPaths = filterPatternPaths(changed);
  const patternViolations = await lintPatternViolations(REPO_ROOT, patternPaths);
  if (patternViolations.length > 0) {
    console.error("✗ Pattern violations found:\n");
    for (const v of patternViolations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}]`);
      console.error(`    ${v.snippet}\n`);
    }
    process.exit(1);
  }
  if (patternPaths.length > 0) console.log("  ✓ No pattern violations");

  const testPaths = filterChangedTestPaths(changed);
  const testViolations = await lintTestNames(
    REPO_ROOT,
    testPaths.length > 0 ? testPaths : undefined
  );
  if (testViolations.length > 0) {
    console.error("✗ Test naming violations:\n");
    for (const line of testViolations) console.error(`  ${line}`);
    process.exit(1);
  }
  if (testPaths.length > 0) console.log("lint:test-names OK");

  if (!pathExists(join(REPO_ROOT, ".oxlintrc.json"))) {
    console.warn("  ⚠ .oxlintrc.json missing");
  }
}

main().catch((err) => {
  console.error("lint-changed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
