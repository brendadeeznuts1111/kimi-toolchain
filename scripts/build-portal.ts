#!/usr/bin/env bun
/**
 * One-command Artifact Portal publish.
 *
 * Usage:
 *   bun run build:portal
 *   bun run build:portal --json
 *   bun run build:portal --local-only
 *   bun run build:portal --dry-run
 */

import { join } from "path";
import { buildArtifactPortal } from "../src/lib/artifact-portal.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const localOnly = Bun.argv.includes("--local-only");
const dryRun = Bun.argv.includes("--dry-run") || Bun.argv.includes("--dryrun");

async function main(): Promise<void> {
  const result = await buildArtifactPortal({
    projectRoot: REPO_ROOT,
    preferProbe: !localOnly,
    dryRun,
  });

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      dryRun
        ? "Artifact Portal dry-run passed (no artifacts written)"
        : `Artifact Portal built at ${result.portalIndexPath}`
    );
    console.log(`  benchmark: ${result.benchmark.runner} (${result.benchmark.source})`);
    console.log(`  diagnostics: ${result.benchmark.artifactPath}`);
    console.log(
      `  converged: ${result.converged} (${result.convergedComponents.map((c) => c.id).join(", ")})`
    );
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
