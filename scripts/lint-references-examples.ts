#!/usr/bin/env bun
/**
 * Validate canonical-references.toml in each example project against the Bun-native validator.
 *
 * Usage:
 *   bun run scripts/lint-references-examples.ts
 *   bun run references:lint:examples
 */

import { join } from "path";
import { readText } from "../src/lib/bun-io.ts";
import {
  CANONICAL_REFERENCES_TOML_FILENAME,
  lintCanonicalReferencesToml,
  repoCanonicalReferencesTomlPath,
} from "../src/lib/canonical-references-toml.ts";

const EXAMPLES_ROOT = join(import.meta.dir, "..", "examples");

const EXAMPLE_DIRS = ["dashboard", "portal", "trading-workspace"];

const allViolations: string[] = [];

for (const dir of EXAMPLE_DIRS) {
  const path = repoCanonicalReferencesTomlPath(join(EXAMPLES_ROOT, dir));
  const text = readText(path);
  const violations = lintCanonicalReferencesToml(text);
  if (violations.length === 0) continue;
  allViolations.push(`examples/${dir}/${CANONICAL_REFERENCES_TOML_FILENAME}:`);
  for (const line of violations) {
    allViolations.push(`  ${line}`);
  }
}

if (allViolations.length > 0) {
  console.error("example canonical-references lint failed:\n");
  for (const line of allViolations) console.error(line);
  process.exit(1);
}

console.log("example canonical-references lint OK");
