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
  finalizeCanonicalReferencesManifest,
  lintRepoReferences,
  lintEcosystemRepoCompleteness,
  repoCanonicalReferencesPath,
  manifestNeedsRefresh,
  readCanonicalReferencesManifest,
} from "../src/lib/canonical-references.ts";
import { stableStringify } from "../src/lib/build-constants-registry.ts";
import { syncCanvasCompanions, canvasCompanionsStale } from "../src/lib/canvas-companion-sync.ts";

const ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = repoCanonicalReferencesPath(ROOT);

function assertRepoReferenceLint(projectRoot: string): void {
  const violations = lintRepoReferences({ projectRoot });
  if (violations.length === 0) return;
  console.error("repo reference lint failed:\n");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const check = Bun.argv.includes("--check");
  const jsonOnly = Bun.argv.includes("--json");
  const existing = await readCanonicalReferencesManifest(ROOT);
  const generated = buildCanonicalReferencesManifest();

  if (jsonOnly) {
    process.stdout.write(stableStringify(generated));
    return;
  }

  assertRepoReferenceLint(ROOT);

  if (check) {
    if (manifestNeedsRefresh(generated, existing)) {
      console.error("canonical-references.json is stale — run: bun run references:generate");
      process.exit(1);
    }
    const ecoViolations = lintEcosystemRepoCompleteness();
    if (ecoViolations.length > 0) {
      console.error("ecosystem ↔ repo completeness violations:\n");
      for (const line of ecoViolations) console.error(`  ${line}`);
      process.exit(1);
    }
    const canvasViolations = await canvasCompanionsStale(ROOT);
    if (canvasViolations.length > 0) {
      console.error("canvas companions stale:\n");
      for (const line of canvasViolations) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log("canonical-references.json OK · ecosystem ↔ repo OK · canvas companions OK");
    return;
  }

  await writeTextAsync(
    MANIFEST_PATH,
    stableStringify(finalizeCanonicalReferencesManifest(generated, existing))
  );
  const canvas = await syncCanvasCompanions(ROOT);
  console.log(
    `wrote canonical-references.json (${generated.ecosystem.length} ecosystem, ${generated.localDocs.length} local docs, ${generated.repos.length} repos)`
  );
  if (canvas.updated.length > 0) {
    console.log(`canvas:generate updated ${canvas.updated.length} companion file(s)`);
  }
}

main().catch((err: Error) => {
  console.error("generate-canonical-references failed:", err.message);
  process.exit(1);
});
