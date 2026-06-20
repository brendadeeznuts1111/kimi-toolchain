#!/usr/bin/env bun
/**
 * Run canonical reference validation rules without regenerating the manifest.
 *
 * Usage:
 *   bun run references:lint
 */

import { join } from "path";
import { lintRepoReferences } from "../src/lib/canonical-references.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const violations = lintRepoReferences({ projectRoot: REPO_ROOT });
if (violations.length > 0) {
  console.error("canonical reference lint failed:\n");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

console.log("canonical references lint OK");
