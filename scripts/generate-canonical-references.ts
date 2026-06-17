#!/usr/bin/env bun
/**
 * Generate canonical-references.json from src/lib/canonical-references.ts.
 *
 * Usage:
 *   bun run scripts/generate-canonical-references.ts          # write manifest
 *   bun run scripts/generate-canonical-references.ts --check  # fail if stale
 *   bun run scripts/generate-canonical-references.ts --json   # stdout only
 */

import { join } from "path";
import { writeTextAsync } from "../src/lib/bun-io.ts";
import {
  buildCanonicalReferencesManifest,
  repoCanonicalReferencesPath,
  manifestNeedsRefresh,
  readCanonicalReferencesManifest,
} from "../src/lib/canonical-references.ts";
import { stableStringify } from "../src/lib/build-constants-registry.ts";

const ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = repoCanonicalReferencesPath(ROOT);

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");
  const jsonOnly = Bun.argv.includes("--json");
  const generated = buildCanonicalReferencesManifest();

  if (jsonOnly) {
    process.stdout.write(stableStringify(generated));
    return;
  }

  if (check) {
    const existing = await readCanonicalReferencesManifest(ROOT);
    if (manifestNeedsRefresh(generated, existing)) {
      console.error("canonical-references.json is stale — run: bun run references:generate");
      process.exit(1);
    }
    console.log("canonical-references.json OK");
    return;
  }

  await writeTextAsync(MANIFEST_PATH, stableStringify(generated));
  console.log(
    `wrote canonical-references.json (${generated.ecosystem.length} ecosystem, ${generated.localDocs.length} local docs, ${generated.repos.length} repos)`
  );
}

main().catch((err: Error) => {
  console.error("generate-canonical-references failed:", err.message);
  process.exit(1);
});
