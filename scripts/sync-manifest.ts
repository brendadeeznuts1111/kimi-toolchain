#!/usr/bin/env bun
/**
 * Generate or verify the desktop sync manifest.
 */

import { writeStdoutJsonSync } from "../src/lib/ndjson.ts";
import { resolveSyncBaselineArchivePath } from "../src/lib/sync-baseline-metrics.ts";
import {
  buildSyncManifest,
  dryRunRestoreBaseline,
  printRestoreDryRunTable,
  verifySyncManifest,
} from "../src/lib/desktop-sync.ts";
import { scriptRepoRoot } from "../src/lib/paths.ts";
import { writeManifest } from "../src/lib/version.ts";

const REPO_ROOT = scriptRepoRoot();

async function main(): Promise<number> {
  const verify = Bun.argv.includes("--verify");
  const baseline = Bun.argv.includes("--baseline");
  const json = Bun.argv.includes("--json");

  if (verify) {
    const report = await verifySyncManifest(REPO_ROOT);
    let baselineOk = true;
    if (baseline) {
      const archivePath = await resolveSyncBaselineArchivePath(REPO_ROOT);
      if (!archivePath) {
        baselineOk = false;
        if (!json) console.error("✗ Baseline archive missing; run bun run sync");
      } else {
        const preview = await dryRunRestoreBaseline(archivePath, REPO_ROOT);
        baselineOk = preview.ok;
        if (!json && preview.driftRows.length > 0) {
          printRestoreDryRunTable(preview.driftRows);
        }
        if (!json && baselineOk) console.log("✓ Baseline archive matches repo hashes");
        else if (!json && !baselineOk) {
          console.error("✗ Baseline archive drift vs repo; run bun run sync");
        }
      }
    }
    if (json) {
      writeStdoutJsonSync(
        {
          ...report,
          baselineChecked: baseline,
          baselineOk: baseline ? baselineOk : undefined,
        },
        2
      );
      return report.ok && baselineOk ? 0 : 1;
    }
    if (report.ok && baselineOk) {
      console.log("✓ Sync manifest hashes match repo and desktop runtime");
      return 0;
    }
    console.error("✗ Sync manifest verification failed");
    if (!report.manifestPresent) console.error("  - manifest missing; run bun run sync");
    if (!report.manifestFresh) {
      console.error(
        `  - stale manifest hashes: ${report.changedHashes.length} changed, ${report.missingHashes.length} missing, ${report.extraHashes.length} extra`
      );
    }
    if (!report.desktopSynced) {
      console.error(
        `  - desktop drift: ${report.drift.drifted.length} drifted, ${report.drift.missing.length} missing`
      );
    }
    console.error("  Run: bun run sync");
    return 1;
  }

  const manifest = await buildSyncManifest(REPO_ROOT);
  await writeManifest(manifest);
  if (json) writeStdoutJsonSync(manifest, 2);
  else {
    const count = Object.keys(manifest.fileHashes ?? {}).length;
    console.log(`✓ Sync manifest generated with ${count} file hash(es)`);
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("sync-manifest failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
