#!/usr/bin/env bun
/**
 * Run canonical reference validation rules without regenerating the manifest.
 *
 * Usage:
 *   bun run references:lint
 */

import { join } from "path";
import { readText } from "../src/lib/bun-io.ts";
import { lintManifestBunNative, lintRepoReferences } from "../src/lib/canonical-references.ts";
import {
  parseCanonicalReferencesToml,
  repoCanonicalReferencesTomlPath,
} from "../src/lib/canonical-references-toml.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const rawToml = await readText(repoCanonicalReferencesTomlPath(REPO_ROOT));
const source = parseCanonicalReferencesToml(rawToml);

const violations = [
  ...lintManifestBunNative({
    schemaVersion: source.manifest.schemaVersion,
    ecosystem: source.ecosystem,
    localDocs: source.localDocs,
    repos: source.repos,
  }),
  ...lintRepoReferences({ projectRoot: REPO_ROOT }),
];

if (violations.length > 0) {
  console.error("canonical reference lint failed:\n");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

console.log("canonical references lint OK");
