#!/usr/bin/env bun
/**
 * One-command Artifact Portal publish.
 *
 * Usage:
 *   bun run build:portal
 *   bun run build:portal --json
 *   bun run build:portal --local-only
 *   bun run build:portal --dry-run
 *   bun run build:portal --gate   # pre-push: local-loop dry-run + convergence validation
 */

import { join } from "path";
import { buildArtifactPortal } from "../src/lib/artifact-portal.ts";
import { validatePortalConvergenceGate } from "../src/lib/benchmark-convergence.ts";

const REPO_ROOT = join(import.meta.dir, "..");
const json = Bun.argv.includes("--json");
const gate = Bun.argv.includes("--gate");
const localOnly = Bun.argv.includes("--local-only") || gate;
const dryRun = Bun.argv.includes("--dry-run") || Bun.argv.includes("--dryrun") || gate;

async function main(): Promise<void> {
  const result = await buildArtifactPortal({
    projectRoot: REPO_ROOT,
    preferProbe: !localOnly,
    dryRun,
  });

  const validation =
    dryRun || gate
      ? validatePortalConvergenceGate(result, {
          requireLocalLoop: localOnly,
          requireImportGraphTitle: gate,
        })
      : { ok: result.converged, errors: result.converged ? [] : ["converged must be true"] };

  if (!validation.ok) {
    for (const message of validation.errors) {
      console.error(`✗ portal convergence: ${message}`);
    }
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      gate
        ? "Artifact Portal gate passed (dry-run, local-loop, no artifacts written)"
        : dryRun
          ? "Artifact Portal dry-run passed (no artifacts written)"
          : `Artifact Portal built at ${result.portalIndexPath}`
    );
    console.log(`  benchmark: ${result.benchmark.runner} (${result.benchmark.source})`);
    console.log(`  diagnostics: ${result.benchmark.artifactPath}`);
    console.log(
      `  config-status: ${result.configStatus.aligned ? "aligned" : "misaligned"} (${result.configStatus.source})`
    );
    console.log(`  config-status artifact: ${result.configStatus.artifactPath}`);
    console.log(
      `  converged: ${result.converged} (${result.convergedComponents.map((c) => c.id).join(", ")})`
    );
    if (result.changedImportGraphTitle) {
      console.log(`  import-graph: ${result.changedImportGraphTitle}`);
      console.log(
        "  inspect: jq '.payload.payload.metadata.testExecution.changedImportGraph.title' <benchmark-artifact>"
      );
    }
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
