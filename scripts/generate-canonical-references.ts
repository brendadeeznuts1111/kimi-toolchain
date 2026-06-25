#!/usr/bin/env bun
/**
 * Generate canonical-references-data.ts and canonical-references.json from canonical-references.toml.
 *
 * Usage:
 *   bun run scripts/generate-canonical-references.ts          # write artifacts
 *   bun run scripts/generate-canonical-references.ts --check  # fail if stale
 *   bun run scripts/generate-canonical-references.ts --json   # stdout only
 */

import { join } from "path";
import { pathExists, readText } from "../src/lib/bun-io.ts";
import {
  buildCanonicalReferencesManifestFromTables,
  finalizeCanonicalReferencesManifest,
  lintRepoReferences,
  lintEcosystemRepoCompleteness,
  repoCanonicalReferencesPath,
  manifestNeedsRefresh,
  readCanonicalReferencesManifest,
} from "../src/lib/canonical-references.ts";
import {
  generateCanonicalReferencesDataTs,
  lintCanonicalReferencesToml,
  parseCanonicalReferencesToml,
  repoCanonicalReferencesTomlPath,
  type CanonicalReferencesTomlSource,
} from "../src/lib/canonical-references-toml.ts";
import { stableStringify } from "../src/lib/build-constants-registry.ts";
import { syncCanvasCompanions } from "../src/lib/canvas-companion-sync.ts";

const ROOT = join(import.meta.dir, "..");
const MANIFEST_PATH = repoCanonicalReferencesPath(ROOT);
const TOML_PATH = repoCanonicalReferencesTomlPath(ROOT);
const DATA_TS_PATH = join(ROOT, "src/lib/canonical-references-data.ts");

async function oxfmtDataTs(source: string): Promise<string> {
  const proc = Bun.spawn(["oxfmt", "--stdin-filepath", DATA_TS_PATH], {
    stdin: new TextEncoder().encode(source),
    stdout: "pipe",
    stderr: "pipe",
  });
  const exit = await proc.exited;
  const out = await Bun.readableStreamToText(proc.stdout);
  if (exit !== 0) {
    const err = await Bun.readableStreamToText(proc.stderr);
    throw new Error(`oxfmt failed on canonical-references-data.ts: ${err.trim()}`);
  }
  return out;
}

async function loadTomlSource(): Promise<{ raw: string; source: CanonicalReferencesTomlSource }> {
  const raw = pathExists(TOML_PATH) ? readText(TOML_PATH) : await Bun.file(TOML_PATH).text();
  return { raw, source: parseCanonicalReferencesToml(raw) };
}

function readExistingDataTs(): string | null {
  if (!pathExists(DATA_TS_PATH)) return null;
  return readText(DATA_TS_PATH);
}

function assertTomlLint(raw: string): void {
  const violations = lintCanonicalReferencesToml(raw);
  if (violations.length === 0) return;
  console.error("canonical-references.toml validation failed:\n");
  for (const line of violations) console.error(`  ${line}`);
  process.exit(1);
}

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
  const { raw, source } = await loadTomlSource();
  assertTomlLint(raw);

  const generatedTs = await oxfmtDataTs(generateCanonicalReferencesDataTs(source));
  const generated = buildCanonicalReferencesManifestFromTables(source);
  const existingDataTs = readExistingDataTs();
  const existing = await readCanonicalReferencesManifest(ROOT);

  if (jsonOnly) {
    process.stdout.write(stableStringify(generated));
    return;
  }

  if (check) {
    if (existingDataTs !== generatedTs) {
      console.error(
        "src/lib/canonical-references-data.ts is stale — run: bun run references:generate"
      );
      process.exit(1);
    }

    assertRepoReferenceLint(ROOT);

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
    console.log(
      "canonical-references.toml OK · canonical-references-data.ts OK · canonical-references.json OK · ecosystem ↔ repo OK"
    );
    return;
  }

  if (existingDataTs !== generatedTs) {
    await Bun.write(DATA_TS_PATH, generatedTs);
    console.log("wrote src/lib/canonical-references-data.ts");
  }

  assertRepoReferenceLint(ROOT);

  await Bun.write(
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
