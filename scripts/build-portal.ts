#!/usr/bin/env bun
/**
 * One-command Artifact Portal publish.
 *
 * Usage:
 *   bun run build:portal
 *   bun run build:portal --json
 *   bun run build:portal --local-only
 */

import { join } from "path";
import { buildArtifactPortal } from "../src/lib/artifact-portal.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const localOnly = Bun.argv.includes("--local-only");

async function main(): Promise<void> {
  const result = await buildArtifactPortal({
    projectRoot: REPO_ROOT,
    preferProbe: !localOnly,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Artifact Portal built at ${result.portalIndexPath}`);
    console.log(`  benchmark: ${result.benchmark.runner} (${result.benchmark.source})`);
    console.log(`  diagnostics: ${result.benchmark.artifactPath}`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
